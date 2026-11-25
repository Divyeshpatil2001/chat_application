import { useState } from 'react';

function previewText(c, user) {
  const lm = c.lastMessage;
  if (!lm) return c.type === 'group' ? `${c.members.length} members` : 'No messages yet';
  if (lm.system) return lm.text;
  const who = lm.senderId === user.id ? 'You' : lm.senderName;
  if (lm.deleted) return `${who}: This message was deleted`;
  if (lm.attachment) return `${who}: ${lm.attachment.type === 'image' ? '📷 Photo' : '🎥 Video'}`;
  return `${who}: ${lm.text}`;
}

export default function Sidebar({ user, users, conversations, activeId, unread, onOpen, onStartDirect, onNewGroup, onDeleteChat, onLogout }) {
  const [tab, setTab] = useState('chats');
  const [search, setSearch] = useState('');
  const q = search.toLowerCase();

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <div className="avatar">{user.username[0].toUpperCase()}</div>
        <strong>{user.username}</strong>
        <button className="link" onClick={onLogout}>Logout</button>
      </header>

      <div className="tabs">
        <button className={tab === 'chats' ? 'active' : ''} onClick={() => setTab('chats')}>Chats</button>
        <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>People</button>
        <button onClick={onNewGroup}>+ Group</button>
      </div>

      <input className="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />

      <ul className="list">
        {tab === 'chats' &&
          conversations
            .filter((c) => c.name.toLowerCase().includes(q))
            .map((c) => (
              <li key={c.id} className={c.id === activeId ? 'active' : ''} onClick={() => onOpen(c.id)}>
                <div className={`avatar ${c.type}`}>{c.type === 'group' ? '#' : c.name[0].toUpperCase()}</div>
                <div className="grow">
                  <div className="row">
                    <strong>{c.name}</strong>
                    {unread[c.id] > 0 && <span className="badge">{unread[c.id]}</span>}
                  </div>
                  <small className="muted ellipsis">{previewText(c, user)}</small>
                </div>
                <button
                  className="icon-btn delete-chat-btn"
                  title="Delete chat"
                  onClick={(e) => { e.stopPropagation(); onDeleteChat(c.id); }}
                >
                  🗑
                </button>
              </li>
            ))}
        {tab === 'chats' && conversations.length === 0 && (
          <li className="muted hint">No chats yet. Open People to start one.</li>
        )}

        {tab === 'people' &&
          users
            .filter((u) => u.username.toLowerCase().includes(q))
            .map((u) => (
              <li key={u.id} onClick={() => { onStartDirect(u.id); setTab('chats'); }}>
                <div className="avatar">{u.username[0].toUpperCase()}</div>
                <div className="grow">
                  <strong>{u.username}</strong>
                  <small className="muted">{u.online ? 'online' : 'offline'}</small>
                </div>
                <span className={`dot ${u.online ? 'on' : ''}`} />
              </li>
            ))}
        {tab === 'people' && users.length === 0 && (
          <li className="muted hint">No other users yet. Register another account in a second browser window.</li>
        )}
      </ul>
    </aside>
  );
}
