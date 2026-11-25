import express from 'express';
import http from 'http';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { Server } from 'socket.io';
import { db } from './db.js';
import { initStorage, saveFile, uploadsDir } from './storage.js';

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET) console.warn('JWT_SECRET not set, using an insecure dev default');

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

// ---------- media uploads ----------
app.use('/uploads', express.static(uploadsDir)); // only used while STORAGE_DRIVER=local

const upload = multer({
  storage: multer.memoryStorage(), // buffer goes straight to disk or MinIO in the route handler
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    const ok = /^image\/|^video\//.test(file.mimetype);
    cb(ok ? null : new Error('Only images and videos are allowed'), ok);
  },
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN } });

// ---------- helpers ----------
const id = () => crypto.randomUUID();
const publicUser = (u) => ({ id: u.id, username: u.username });
const onlineUsers = new Map(); // userId -> number of open sockets

function sign(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    const { id } = jwt.verify(token, JWT_SECRET);
    req.user = db.findUserById(id);
    if (!req.user) throw new Error();
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// Turns a stored message into what a specific viewer is allowed to see:
// hidden entirely if they deleted it "for me", redacted if it was deleted "for everyone".
function serializeMessage(m, viewerId) {
  if (m.isSystem) return { id: m.id, conversationId: m.conversationId, system: true, text: m.text, createdAt: m.createdAt };
  if (db.isMessageDeletedForUser(m.id, viewerId)) return null;
  if (m.deletedForEveryone) {
    return { id: m.id, conversationId: m.conversationId, senderId: m.senderId, senderName: m.senderName, text: null, attachment: null, deleted: true, createdAt: m.createdAt };
  }
  return { id: m.id, conversationId: m.conversationId, senderId: m.senderId, senderName: m.senderName, text: m.text || null, attachment: m.attachment || null, deleted: false, editedAt: m.editedAt || null, createdAt: m.createdAt };
}

function conversationView(conversationId, viewerId) {
  const c = db.getConversation(conversationId);
  const since = db.getDeletedAt(conversationId, viewerId); // "delete chat for me" hides everything up to this point
  const visible = db.getMessagesForConversation(conversationId, since);
  let last = null;
  for (let i = visible.length - 1; i >= 0 && !last; i--) last = serializeMessage(visible[i], viewerId);

  const members = db.getMembers(conversationId).map((uid) => publicUser(db.findUserById(uid)));
  // For direct chats, the display name is the other person's username.
  const name = c.type === 'group' ? c.name : members.find((m) => m.id !== viewerId)?.username || 'Unknown';
  return { id: c.id, type: c.type, name, adminId: c.adminId, members, lastMessage: last };
}

function emitConversation(conversationId) {
  for (const uid of db.getMembers(conversationId)) io.to(uid).emit('conversation:updated', conversationView(conversationId, uid));
}

function getMemberConversation(req, res) {
  const c = db.getConversation(req.params.id);
  if (!c || !db.isMember(c.id, req.user.id)) {
    res.status(404).json({ error: 'Conversation not found' });
    return null;
  }
  return c;
}

function systemMessage(conversationId, text) {
  const msg = db.createMessage({ id: id(), conversationId, isSystem: true, text, createdAt: new Date().toISOString() });
  for (const uid of db.getMembers(conversationId)) io.to(uid).emit('message:new', serializeMessage(msg, uid));
}

// ---------- auth ----------
app.post('/api/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: 'Username: 3-20 letters, numbers or _' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be 6+ characters' });
  if (db.findUserByUsername(username)) return res.status(409).json({ error: 'Username already taken' });

  const user = { id: id(), username, createdAt: new Date().toISOString() };
  db.createUser({ ...user, passwordHash: await bcrypt.hash(password, 10) });
  io.emit('user:new', publicUser(user));
  res.json({ token: sign(user), user: publicUser(user) });
});

app.post('/api/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const user = db.findUserByUsername(username);
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash)))
    return res.status(401).json({ error: 'Invalid username or password' });
  res.json({ token: sign(user), user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => res.json(publicUser(req.user)));

// ---------- users ----------
app.get('/api/users', auth, (req, res) => {
  res.json(db.listUsersExcept(req.user.id).map((u) => ({ ...publicUser(u), online: onlineUsers.has(u.id) })));
});

// ---------- conversations ----------
app.get('/api/conversations', auth, (req, res) => {
  const list = db
    .getConversationsForUser(req.user.id)
    .map((c) => conversationView(c.id, req.user.id))
    // A chat the user deleted stays hidden until a fresh message arrives in it.
    .filter((c) => !db.getDeletedAt(c.id, req.user.id) || c.lastMessage)
    .sort((a, b) => (b.lastMessage?.createdAt || '').localeCompare(a.lastMessage?.createdAt || ''));
  res.json(list);
});

// Delete a chat for the current user only. The other member(s) keep their copy,
// and it reappears for this user automatically if a new message arrives.
app.delete('/api/conversations/:id', auth, (req, res) => {
  const c = getMemberConversation(req, res);
  if (!c) return;
  db.setDeletedAt(c.id, req.user.id, new Date().toISOString());
  res.json({ ok: true });
});

// Start (or reuse) a one-to-one chat.
app.post('/api/conversations/direct', auth, (req, res) => {
  const other = db.findUserById(req.body.userId);
  if (!other || other.id === req.user.id) return res.status(400).json({ error: 'Invalid user' });

  let convId = db.findDirectConversationId(req.user.id, other.id);
  if (!convId) {
    convId = id();
    db.createConversation({ id: convId, type: 'direct', memberIds: [req.user.id, other.id], createdAt: new Date().toISOString() });
    emitConversation(convId);
  }
  res.json(conversationView(convId, req.user.id));
});

// Create a group with selected people.
app.post('/api/conversations/group', auth, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 50) return res.status(400).json({ error: 'Group name is required (max 50)' });
  const memberIds = [...new Set([req.user.id, ...(req.body.memberIds || [])])].filter((uid) => db.findUserById(uid));
  if (memberIds.length < 2) return res.status(400).json({ error: 'Add at least one other person' });

  const convId = id();
  db.createConversation({ id: convId, type: 'group', name, adminId: req.user.id, memberIds, createdAt: new Date().toISOString() });
  emitConversation(convId);
  res.json(conversationView(convId, req.user.id));
});

// Add people to an existing group (any member can add).
app.post('/api/conversations/:id/members', auth, (req, res) => {
  const c = getMemberConversation(req, res);
  if (!c) return;
  if (c.type !== 'group') return res.status(400).json({ error: 'Not a group' });
  const existing = db.getMembers(c.id);
  const toAdd = (req.body.memberIds || []).filter((uid) => db.findUserById(uid) && !existing.includes(uid));
  db.addMembers(c.id, toAdd);
  for (const uid of toAdd) systemMessage(c.id, `${req.user.username} added ${db.findUserById(uid).username}`);
  emitConversation(c.id);
  res.json(conversationView(c.id, req.user.id));
});

// Leave a group.
app.delete('/api/conversations/:id/members/me', auth, (req, res) => {
  const c = getMemberConversation(req, res);
  if (!c) return;
  if (c.type !== 'group') return res.status(400).json({ error: 'Not a group' });
  db.removeMember(c.id, req.user.id);
  systemMessage(c.id, `${req.user.username} left the group`);
  emitConversation(c.id);
  io.to(req.user.id).emit('conversation:removed', c.id);
  res.json({ ok: true });
});

app.get('/api/conversations/:id/messages', auth, (req, res) => {
  const c = getMemberConversation(req, res);
  if (!c) return;
  const since = db.getDeletedAt(c.id, req.user.id);
  res.json(
    db
      .getMessagesForConversation(c.id, since)
      .map((m) => serializeMessage(m, req.user.id))
      .filter(Boolean)
  );
});

// Upload a photo or video. Returns a URL the client points <img>/<video> at
// (relative for local disk, absolute for MinIO/S3).
app.post('/api/upload', auth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    try {
      const filename = `${crypto.randomUUID()}${path.extname(req.file.originalname).slice(0, 10)}`;
      const url = await saveFile(req.file.buffer, filename, req.file.mimetype);
      res.json({ url, type: req.file.mimetype.startsWith('video') ? 'video' : 'image', name: req.file.originalname });
    } catch (e) {
      console.error('Upload failed:', e);
      res.status(500).json({ error: 'Could not store the file' });
    }
  });
});

// ---------- sockets ----------
io.use((socket, next) => {
  try {
    const { id } = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
    socket.user = db.findUserById(id);
    if (!socket.user) throw new Error();
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  const uid = socket.user.id;
  socket.join(uid); // personal room: everything for this user is sent here
  onlineUsers.set(uid, (onlineUsers.get(uid) || 0) + 1);
  io.emit('presence', { userId: uid, online: true });

  socket.on('message:send', ({ conversationId, text, attachment }, ack) => {
    const members = db.getMembers(conversationId);
    text = String(text || '').trim().slice(0, 2000);
    const hasAttachment = attachment?.url && attachment?.type;
    if (!members.includes(uid) || (!text && !hasAttachment)) return ack?.({ error: 'Cannot send' });

    const msg = db.createMessage({
      id: id(),
      conversationId,
      senderId: uid,
      senderName: socket.user.username,
      text: text || null,
      attachment: hasAttachment ? { url: attachment.url, type: attachment.type, name: attachment.name || null } : null,
      createdAt: new Date().toISOString(),
    });
    for (const mid of members) io.to(mid).emit('message:new', serializeMessage(msg, mid));
    ack?.({ ok: true });
  });

  // Only the original sender can edit, and only while the message hasn't been redacted.
  socket.on('message:edit', ({ messageId, text }, ack) => {
    const msg = db.getMessage(messageId);
    const members = msg && db.getMembers(msg.conversationId);
    if (!msg || !members?.includes(uid)) return ack?.({ error: 'Message not found' });
    if (msg.senderId !== uid) return ack?.({ error: 'Only the sender can edit this message' });
    if (msg.deletedForEveryone) return ack?.({ error: 'Cannot edit a deleted message' });

    text = String(text || '').trim().slice(0, 2000);
    if (!text) return ack?.({ error: 'Message cannot be empty' });

    db.editMessage(messageId, text, new Date().toISOString());
    const updated = db.getMessage(messageId);
    for (const mid of members) io.to(mid).emit('message:new', serializeMessage(updated, mid));
    ack?.({ ok: true });
  });

  // mode: 'me' hides the message only for the caller; 'everyone' redacts it for all members
  // (and only the original sender is allowed to do that).
  socket.on('message:delete', ({ messageId, mode }, ack) => {
    const msg = db.getMessage(messageId);
    const members = msg && db.getMembers(msg.conversationId);
    if (!msg || !members?.includes(uid)) return ack?.({ error: 'Message not found' });

    if (mode === 'everyone') {
      if (msg.senderId !== uid) return ack?.({ error: 'Only the sender can delete for everyone' });
      db.setDeletedForEveryone(messageId);
      const updated = db.getMessage(messageId);
      for (const mid of members) io.to(mid).emit('message:new', serializeMessage(updated, mid));
    } else {
      db.addMessageDeletionForUser(messageId, uid);
      io.to(uid).emit('message:removed', { id: messageId, conversationId: msg.conversationId });
    }
    ack?.({ ok: true });
  });

  socket.on('typing', ({ conversationId }) => {
    if (!db.isMember(conversationId, uid)) return;
    for (const mid of db.getMembers(conversationId))
      if (mid !== uid) io.to(mid).emit('typing', { conversationId, username: socket.user.username });
  });

  socket.on('disconnect', () => {
    const n = (onlineUsers.get(uid) || 1) - 1;
    if (n <= 0) {
      onlineUsers.delete(uid);
      io.emit('presence', { userId: uid, online: false });
    } else onlineUsers.set(uid, n);
  });
});

initStorage()
  .catch((err) => {
    console.error('Storage init failed:', err.message);
    process.exit(1);
  })
  .then(() => {
    server.listen(PORT, () => console.log(`Chat server on http://localhost:${PORT}`));
  });
