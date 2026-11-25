import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, API_URL, uploadFile } from '../api.js';
import Sidebar from './Sidebar.jsx';
import ChatWindow from './ChatWindow.jsx';
import UserPicker from './UserPicker.jsx';

export default function Chat({ token, user, onLogout }) {
  const [users, setUsers] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState({}); // conversationId -> messages[]
  const [unread, setUnread] = useState({}); // conversationId -> count
  const [typing, setTyping] = useState({}); // conversationId -> username
  const [modal, setModal] = useState(null); // 'group' | 'add' | null
  const socketRef = useRef(null);
  const activeRef = useRef(null);
  activeRef.current = activeId;

  useEffect(() => {
    api('/users', { token }).then(setUsers);
    api('/conversations', { token }).then(setConversations);

    const socket = io(API_URL, { auth: { token } });
    socketRef.current = socket;

    socket.on('connect_error', (err) => err.message === 'Unauthorized' && onLogout());

    socket.on('message:new', (msg) => {
      // Upsert by id: a brand-new message appends, but a "deleted for everyone" update
      // for an existing id patches it in place instead of creating a duplicate.
      setMessages((prev) => {
        const list = prev[msg.conversationId];
        if (!list) return prev; // conversation history not loaded yet; it'll be fetched fresh when opened
        const i = list.findIndex((m) => m.id === msg.id);
        const nextList = i >= 0 ? list.map((m, idx) => (idx === i ? msg : m)) : [...list, msg];
        return { ...prev, [msg.conversationId]: nextList };
      });
      setConversations((prev) => {
        const list = prev.map((c) => (c.id === msg.conversationId ? { ...c, lastMessage: msg } : c));
        const i = list.findIndex((c) => c.id === msg.conversationId);
        if (i > 0) list.unshift(list.splice(i, 1)[0]); // move to top
        return list;
      });
      if (msg.conversationId !== activeRef.current && msg.senderId !== user.id && !msg.deleted)
        setUnread((u) => ({ ...u, [msg.conversationId]: (u[msg.conversationId] || 0) + 1 }));
      setTyping((t) => ({ ...t, [msg.conversationId]: null }));
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

    return () => socket.disconnect();
  }, [token]);

  async function openConversation(id) {
    setActiveId(id);
    setUnread((u) => ({ ...u, [id]: 0 }));
    if (!messages[id]) {
      const list = await api(`/conversations/${id}/messages`, { token });
      setMessages((prev) => ({ ...prev, [id]: list }));
    }
  }

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

  function send(text) {
    socketRef.current.emit('message:send', { conversationId: activeId, text });
  }

  async function sendFile(file) {
    const attachment = await uploadFile(token, file);
    socketRef.current.emit('message:send', { conversationId: activeId, attachment });
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
          onSend={send}
          onSendFile={sendFile}
          onDeleteMessage={deleteMessage}
          onEditMessage={editMessage}
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
