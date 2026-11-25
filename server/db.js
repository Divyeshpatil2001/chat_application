// SQLite-backed persistence, built on Node's native node:sqlite (no native module to compile).
// Every write is synchronous and committed immediately, so data survives a restart or crash —
// unlike the old JSON-file version, which batched writes and could lose the last 200ms of them.
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// DATA_DIR lets Docker keep the database in a named volume; defaults to the server folder.
const dataDir = process.env.DATA_DIR || path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'chat.db');
const conn = new DatabaseSync(dbPath);
conn.exec('PRAGMA journal_mode = WAL;');
conn.exec('PRAGMA foreign_keys = ON;');

conn.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('direct', 'group')),
    name TEXT,
    admin_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    deleted_at TEXT,
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    sender_id TEXT,
    sender_name TEXT,
    text TEXT,
    attachment_url TEXT,
    attachment_type TEXT,
    attachment_name TEXT,
    is_system INTEGER NOT NULL DEFAULT 0,
    deleted_for_everyone INTEGER NOT NULL DEFAULT 0,
    edited_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

  CREATE TABLE IF NOT EXISTS message_deletions (
    message_id TEXT NOT NULL REFERENCES messages(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY (message_id, user_id)
  );
`);

const stmt = (sql) => conn.prepare(sql);

const q = {
  insertUser: stmt('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'),
  userByUsername: stmt('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
  userById: stmt('SELECT * FROM users WHERE id = ?'),
  usersExcept: stmt('SELECT * FROM users WHERE id != ? ORDER BY username'),

  insertConversation: stmt('INSERT INTO conversations (id, type, name, admin_id, created_at) VALUES (?, ?, ?, ?, ?)'),
  conversationById: stmt('SELECT * FROM conversations WHERE id = ?'),
  setAdmin: stmt('UPDATE conversations SET admin_id = ? WHERE id = ?'),
  conversationsForUser: stmt(`
    SELECT c.* FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE cm.user_id = ?
  `),
  directConversationBetween: stmt(`
    SELECT c.id FROM conversations c
    JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
    JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
    WHERE c.type = 'direct'
  `),

  addMember: stmt('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)'),
  removeMember: stmt('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?'),
  membersOf: stmt('SELECT user_id FROM conversation_members WHERE conversation_id = ? ORDER BY rowid'),
  isMember: stmt('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'),
  firstMemberExcept: stmt('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ? ORDER BY rowid LIMIT 1'),
  setDeletedAt: stmt('UPDATE conversation_members SET deleted_at = ? WHERE conversation_id = ? AND user_id = ?'),
  getDeletedAt: stmt('SELECT deleted_at FROM conversation_members WHERE conversation_id = ? AND user_id = ?'),

  insertMessage: stmt(`
    INSERT INTO messages (id, conversation_id, sender_id, sender_name, text, attachment_url, attachment_type, attachment_name, is_system, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  messageById: stmt('SELECT * FROM messages WHERE id = ?'),
  messagesForConversation: stmt('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at'),
  messagesForConversationSince: stmt('SELECT * FROM messages WHERE conversation_id = ? AND created_at > ? ORDER BY created_at'),
  setDeletedForEveryone: stmt('UPDATE messages SET deleted_for_everyone = 1 WHERE id = ?'),
  editMessageText: stmt('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?'),
  addMessageDeletion: stmt('INSERT OR IGNORE INTO message_deletions (message_id, user_id) VALUES (?, ?)'),
  isMessageDeletedForUser: stmt('SELECT 1 FROM message_deletions WHERE message_id = ? AND user_id = ?'),
};

const toCamelMessage = (r) =>
  r && {
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    senderName: r.sender_name,
    text: r.text,
    attachment: r.attachment_url ? { url: r.attachment_url, type: r.attachment_type, name: r.attachment_name } : null,
    isSystem: !!r.is_system,
    deletedForEveryone: !!r.deleted_for_everyone,
    editedAt: r.edited_at,
    createdAt: r.created_at,
  };

const toCamelConversation = (r) => r && { id: r.id, type: r.type, name: r.name, adminId: r.admin_id, createdAt: r.created_at };

export const db = {
  // ---- users ----
  createUser({ id, username, passwordHash, createdAt }) {
    q.insertUser.run(id, username, passwordHash, createdAt);
  },
  findUserByUsername(username) {
    return q.userByUsername.get(username);
  },
  findUserById(id) {
    return q.userById.get(id);
  },
  listUsersExcept(id) {
    return q.usersExcept.all(id);
  },

  // ---- conversations ----
  createConversation({ id, type, name, adminId, memberIds, createdAt }) {
    conn.exec('BEGIN');
    try {
      q.insertConversation.run(id, type, name ?? null, adminId ?? null, createdAt);
      for (const uid of memberIds) q.addMember.run(id, uid);
      conn.exec('COMMIT');
    } catch (err) {
      conn.exec('ROLLBACK');
      throw err;
    }
  },
  getConversation(id) {
    return toCamelConversation(q.conversationById.get(id));
  },
  getConversationsForUser(userId) {
    return q.conversationsForUser.all(userId).map(toCamelConversation);
  },
  findDirectConversationId(userA, userB) {
    return q.directConversationBetween.get(userA, userB)?.id || null;
  },
  getMembers(conversationId) {
    return q.membersOf.all(conversationId).map((r) => r.user_id);
  },
  isMember(conversationId, userId) {
    return !!q.isMember.get(conversationId, userId);
  },
  addMembers(conversationId, memberIds) {
    for (const uid of memberIds) q.addMember.run(conversationId, uid);
  },
  removeMember(conversationId, userId) {
    q.removeMember.run(conversationId, userId);
    const c = q.conversationById.get(conversationId);
    if (c?.admin_id === userId) {
      const next = q.firstMemberExcept.get(conversationId, userId);
      q.setAdmin.run(next?.user_id || null, conversationId);
    }
  },
  getDeletedAt(conversationId, userId) {
    return q.getDeletedAt.get(conversationId, userId)?.deleted_at || null;
  },
  setDeletedAt(conversationId, userId, iso) {
    q.setDeletedAt.run(iso, conversationId, userId);
  },

  // ---- messages ----
  createMessage({ id, conversationId, senderId, senderName, text, attachment, isSystem, createdAt }) {
    q.insertMessage.run(
      id,
      conversationId,
      senderId ?? null,
      senderName ?? null,
      text ?? null,
      attachment?.url ?? null,
      attachment?.type ?? null,
      attachment?.name ?? null,
      isSystem ? 1 : 0,
      createdAt
    );
    return toCamelMessage(q.messageById.get(id));
  },
  getMessage(id) {
    return toCamelMessage(q.messageById.get(id));
  },
  getMessagesForConversation(conversationId, since) {
    const rows = since ? q.messagesForConversationSince.all(conversationId, since) : q.messagesForConversation.all(conversationId);
    return rows.map(toCamelMessage);
  },
  setDeletedForEveryone(messageId) {
    q.setDeletedForEveryone.run(messageId);
  },
  editMessage(messageId, text, editedAt) {
    q.editMessageText.run(text, editedAt, messageId);
  },
  addMessageDeletionForUser(messageId, userId) {
    q.addMessageDeletion.run(messageId, userId);
  },
  isMessageDeletedForUser(messageId, userId) {
    return !!q.isMessageDeletedForUser.get(messageId, userId);
  },
};
