import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, API_URL, uploadFile } from '../api.js';
import { notify } from '../notifications.js';
import { useTheme } from '../theme.js';
import Sidebar from './Sidebar.jsx';
import ChatWindow from './ChatWindow.jsx';
import UserPicker from './UserPicker.jsx';

const isLooking = () => document.visibilityState === 'visible' && document.hasFocus();

function notificationBody(msg) {
  if (msg.text) return msg.text;
  if (msg.attachment) return msg.attachment.type === 'video' ? '🎥 Video' : '📷 Photo';
  return 'New message';
}

export default function Chat({ token, user, onLogout }) {
  const [users, setUsers] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState({}); // conversationId -> messages[]
  const [unread, setUnread] = useState({}); // conversationId -> count
  const [typing, setTyping] = useState({}); // conversationId -> username
  const [modal, setModal] = useState(null); // 'group' | 'add' | null
  const theme = useTheme();
  const socketRef = useRef(null);

  // Socket handlers are registered once, so they read current state through refs.
  const activeRef = useRef(null);
  activeRef.current = activeId;
  const conversationsRef = useRef([]);
  conversationsRef.current = conversations;
  const openRef = useRef(null);
  const markReadRef = useRef(null);

  useEffect(() => {
    api('/users', { token }).then(setUsers);
    api('/conversations', { token }).then(setConversations);
    const socket = io(API_URL, { auth: { token } });
    socketRef.current = socket;

    socket.on('connect_error', (err) => err.message === 'Unauthorized' && onLogout());

    socket.on('message:new', (msg) => {
      setMessages((prev) => {
        const list = prev[msg.conversationId];
        if (!list) return prev; // conversation history not loaded yet; it'll be fetched fresh when opened
        if (list.some((m) => m.id === msg.id)) return prev;
        return { ...prev, [msg.conversationId]: [...list, msg] };
      });
      setConversations((prev) => {
        const list = prev.map((c) => (c.id === msg.conversationId ? { ...c, lastMessage: msg } : c));
        const i = list.findIndex((c) => c.id === msg.conversationId);
        if (i > 0) list.unshift(list.splice(i, 1)[0]); // move to top
        return list;
      });
      setTyping((t) => ({ ...t, [msg.conversationId]: null }));

      if (msg.system || msg.senderId === user.id) return;
      socket.emit('message:ack', { messageIds: [msg.id] });
      const viewing = msg.conversationId === activeRef.current && isLooking();
      if (msg.conversationId !== activeRef.current)
        setUnread((u) => ({ ...u, [msg.conversationId]: (u[msg.conversationId] || 0) + 1 }));
      if (!viewing) {
        const conv = conversationsRef.current.find((c) => c.id === msg.conversationId);
        const mentioned = msg.mentions?.includes(user.id);
        const where = conv?.type === 'group' ? ` in ${conv.name}` : '';
        notify({
          title: mentioned ? `${msg.senderName} mentioned you${where}` : conv?.type === 'group' ? `${msg.senderName} · ${conv.name}` : msg.senderName,
          body: notificationBody(msg),
          tag: msg.id,
          onClick: () => openRef.current(msg.conversationId),
        });
      }
    });

    // An existing message changed (edit, reaction, delete for everyone, link preview).
    // Patched in place: no reordering, no unread bump, no notification.
    socket.on('message:updated', (msg) => {
      setMessages((prev) => {
        const list = prev[msg.conversationId];
        if (!list) return prev;
        // Replies embed a snippet of the original, so refresh those too.
        const snippet = { id: msg.id, senderId: msg.senderId, senderName: msg.senderName, text: msg.text?.slice(0, 140) || null, attachmentType: msg.attachment?.type || null, deleted: !!msg.deleted };
        return {
          ...prev,
          [msg.conversationId]: list.map((m) => (m.id === msg.id ? msg : m.replyTo?.id === msg.id ? { ...m, replyTo: snippet } : m)),
        };
      });
      setConversations((prev) =>
        prev.map((c) => (c.id === msg.conversationId && c.lastMessage?.id === msg.id ? { ...c, lastMessage: msg } : c))
      );
    });

    socket.on('message:receipts', ({ conversationId, receipts }) => {
      const byId = new Map(receipts.map((r) => [r.id, r]));
      setMessages((prev) => {
        const list = prev[conversationId];
        if (!list) return prev;
        return {
          ...prev,
          [conversationId]: list.map((m) => {
            const r = byId.get(m.id);
            return r ? { ...m, deliveredTo: r.deliveredTo, readBy: r.readBy } : m;
          }),
        };
      });
    });

    // "Delete for me" only affects the caller, so the server tells just that socket to drop it locally.
    socket.on('message:removed', ({ id: msgId, conversationId }) => {
      setMessages((prev) =>
        prev[conversationId] ? { ...prev, [conversationId]: prev[conversationId].filter((m) => m.id !== msgId) } : prev
      );
    });

    socket.on('conversation:updated', (conv) =>
      setConversations((prev) =>
        prev.some((c) => c.id === conv.id) ? prev.map((c) => (c.id === conv.id ? conv : c)) : [conv, ...prev]
      )
    );
    socket.on('conversation:removed', (cid) => {
      setConversations((prev) => prev.filter((c) => c.id !== cid));
      if (activeRef.current === cid) setActiveId(null);
    });
    socket.on('user:new', (u) => u.id !== user.id && setUsers((prev) => [...prev, { ...u, online: false }]));
    socket.on('presence', ({ userId, online }) =>
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, online } : u)))
    );

    const timers = {};
    socket.on('typing', ({ conversationId, username }) => {
      setTyping((t) => ({ ...t, [conversationId]: username }));
      clearTimeout(timers[conversationId]);
      timers[conversationId] = setTimeout(() => setTyping((t) => ({ ...t, [conversationId]: null })), 2000);
    });

    // Coming back to the tab counts as reading whatever is open.
    const onFocus = () => markReadRef.current?.();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      socket.disconnect();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [token]);

  // Tell the server we've read the open conversation, but only if it has something we haven't read
  // and the user can actually see it.
  function markReadIfNeeded() {
    const list = messages[activeId];
    if (!activeId || !list || !isLooking()) return;
    if (list.some((m) => !m.system && !m.deleted && m.senderId !== user.id && !m.readBy?.includes(user.id)))
      socketRef.current?.emit('conversation:read', { conversationId: activeId });
  }
  markReadRef.current = markReadIfNeeded;
  useEffect(markReadIfNeeded, [activeId, messages[activeId]]);

  async function openConversation(id) {
    setActiveId(id);
    setUnread((u) => ({ ...u, [id]: 0 }));
    if (!messages[id]) {
      const list = await api(`/conversations/${id}/messages`, { token });
      setMessages((prev) => ({ ...prev, [id]: list }));
    }
  }
  openRef.current = openConversation;

  async function startDirect(userId) {
    const conv = await api('/conversations/direct', { token, method: 'POST', body: { userId } });
    setConversations((prev) => (prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev]));
    openConversation(conv.id);
  }

  async function createGroup(name, memberIds) {
    const conv = await api('/conversations/group', { token, method: 'POST', body: { name, memberIds } });
    setConversations((prev) => (prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev]));
    setModal(null);
    openConversation(conv.id);
  }

  async function addMembers(_, memberIds) {
    await api(`/conversations/${activeId}/members`, { token, method: 'POST', body: { memberIds } });
    setModal(null);
  }

  async function leaveGroup() {
    if (!confirm('Leave this group?')) return;
    await api(`/conversations/${activeId}/members/me`, { token, method: 'DELETE' });
  }

  // Removes the chat from this user's list only; it reappears automatically on a new message.
  async function deleteChat(id) {
    if (!confirm('Delete this chat? It stays visible for the other participant(s).')) return;
    await api(`/conversations/${id}`, { token, method: 'DELETE' });
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setMessages((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
    if (activeId === id) setActiveId(null);
  }

  function deleteMessage(messageId, mode) {
    socketRef.current.emit('message:delete', { messageId, mode });
  }

  function editMessage(messageId, text) {
    socketRef.current.emit('message:edit', { messageId, text });
  }

  function reactToMessage(messageId, emoji) {
    socketRef.current.emit('message:react', { messageId, emoji });
  }

  function send(text, replyToId) {
    socketRef.current.emit('message:send', { conversationId: activeId, text, replyToId });
  }

  async function sendFile(file, replyToId) {
    const attachment = await uploadFile(token, file);
    socketRef.current.emit('message:send', { conversationId: activeId, attachment, replyToId });
  }

  const active = conversations.find((c) => c.id === activeId);

  return (
    <div className="app">
      <Sidebar
        user={user}
        users={users}
        conversations={conversations}
        activeId={activeId}
        unread={unread}
        theme={theme}
        onOpen={openConversation}
        onStartDirect={startDirect}
        onNewGroup={() => setModal('group')}
        onDeleteChat={deleteChat}
        onLogout={onLogout}
      />
      {active ? (
        <ChatWindow
          user={user}
          users={users}
          conversation={active}
          messages={messages[active.id] || []}
          typing={typing[active.id]}
          theme={theme.resolved}
          onSend={send}
          onSendFile={sendFile}
          onDeleteMessage={deleteMessage}
          onEditMessage={editMessage}
          onReact={reactToMessage}
          onTyping={() => socketRef.current.emit('typing', { conversationId: active.id })}
          onAddPeople={() => setModal('add')}
          onLeave={leaveGroup}
          onClose={() => setActiveId(null)}
        />
      ) : (
        <div className="empty">Select a chat or start a new one</div>
      )}
      {modal === 'group' && (
        <UserPicker title="New group" users={users} askName onSubmit={createGroup} onClose={() => setModal(null)} />
      )}
      {modal === 'add' && active && (
        <UserPicker
          title={`Add people to ${active.name}`}
          users={users.filter((u) => !active.members.some((m) => m.id === u.id))}
          onSubmit={addMembers}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
