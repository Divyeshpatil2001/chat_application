import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../api.js';
import Lightbox from './Lightbox.jsx';

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Attachment({ attachment, onPreview }) {
  const src = mediaUrl(attachment.url);
  if (attachment.type === 'video')
    return (
      <div className="attachment-wrap">
        <video src={src} controls className="attachment attachment-video" />
        <button type="button" className="icon-btn expand-btn" title="Full screen" onClick={() => onPreview({ ...attachment, url: src })}>⤢</button>
      </div>
    );
  return (
    <img
      src={src}
      alt={attachment.name || 'photo'}
      className="attachment attachment-img"
      onClick={() => onPreview({ ...attachment, url: src })}
    />
  );
}

export default function ChatWindow({ user, users, conversation, messages, typing, onSend, onSendFile, onDeleteMessage, onEditMessage, onTyping, onAddPeople, onLeave, onClose }) {
  const [text, setText] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const [menu, setMenu] = useState(null); // { message, x, y } | null — screen coords, so it floats above everything
  const [preview, setPreview] = useState(null); // attachment being shown full-screen, or null
  const [editingId, setEditingId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const isGroup = conversation.type === 'group';
  const other = !isGroup && users.find((u) => conversation.members.some((m) => m.id === u.id));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, conversation.id]);

  useEffect(() => {
    setShowMembers(false);
    setMenu(null);
    setPreview(null);
    setEditingId(null);
    setText('');
  }, [conversation.id]);

  function openMenu(e, message) {
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({ message, x: rect.right, y: rect.bottom });
  }

  function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    if (editingId) {
      onEditMessage(editingId, text);
      setEditingId(null);
    } else {
      onSend(text);
    }
    setText('');
  }

  function startEdit(message) {
    setMenu(null);
    setEditingId(message.id);
    setText(message.text || '');
  }

  function cancelEdit() {
    setEditingId(null);
    setText('');
  }

  async function pickFile(e) {
    const file = e.target.files[0];
    e.target.value = ''; // allow picking the same file again later
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      await onSendFile(file);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function requestDelete(messageId, mode) {
    setMenu(null);
    if (mode === 'everyone' && !confirm('Delete this message for everyone?')) return;
    onDeleteMessage(messageId, mode);
  }

  return (
    <main className="chat">
      <header className="chat-head">
        <button className="icon-btn back-btn" title="Close chat" onClick={onClose}>←</button>
        <div className={`avatar ${conversation.type}`}>{isGroup ? '#' : conversation.name[0].toUpperCase()}</div>
        <div className="grow">
          <strong>{conversation.name}</strong>
          <small className="muted">
            {typing
              ? `${typing} is typing…`
              : isGroup
                ? conversation.members.map((m) => (m.id === user.id ? 'You' : m.username)).join(', ')
                : other?.online ? 'online' : 'offline'}
          </small>
        </div>
        {isGroup && (
          <>
            <button className="secondary" onClick={() => setShowMembers((s) => !s)}>Members ({conversation.members.length})</button>
            <button onClick={onAddPeople}>+ Add people</button>
            <button className="danger" onClick={onLeave}>Leave</button>
          </>
        )}
      </header>

      <div className="body">
        <div className="messages">
          {messages.map((m) =>
            m.system ? (
              <div key={m.id} className="system">{m.text}</div>
            ) : (
              <div key={m.id} className={`msg ${m.senderId === user.id ? 'mine' : ''}`}>
                {isGroup && m.senderId !== user.id && !m.deleted && <div className="sender">{m.senderName}</div>}

                {!m.deleted && (
                  <button className="icon-btn msg-menu-btn" onClick={(e) => openMenu(e, m)}>⋮</button>
                )}

                {m.deleted ? (
                  <div className="deleted-text">🚫 This message was deleted</div>
                ) : (
                  <>
                    {m.attachment && <Attachment attachment={m.attachment} onPreview={setPreview} />}
                    {m.text && <div className="msg-text">{m.text}</div>}
                  </>
                )}
                <div className="time">
                  {m.editedAt && !m.deleted && <span className="edited-tag">edited · </span>}
                  {time(m.createdAt)}
                </div>
              </div>
            )
          )}
          <div ref={bottomRef} />
        </div>

        {showMembers && (
          <aside className="members">
            <h4>Members</h4>
            {conversation.members.map((m) => (
              <div key={m.id} className="row">
                <span>{m.id === user.id ? `${m.username} (you)` : m.username}</span>
                {m.id === conversation.adminId && <small className="badge">admin</small>}
              </div>
            ))}
          </aside>
        )}
      </div>

      {/* Fixed to the viewport (not nested in the scrolling message list) so it can never be
          clipped by that container's overflow, and always paints above the sidebar. */}
      {menu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(null)} />
          <div className="msg-menu" style={{ top: menu.y + 4, left: menu.x - 170 }}>
            {menu.message.senderId === user.id && menu.message.text && (
              <button onClick={() => startEdit(menu.message)}>Edit</button>
            )}
            <button onClick={() => requestDelete(menu.message.id, 'me')}>Delete for me</button>
            {menu.message.senderId === user.id && (
              <button onClick={() => requestDelete(menu.message.id, 'everyone')}>Delete for everyone</button>
            )}
          </div>
        </>
      )}

      {uploadError && <p className="error upload-error">{uploadError}</p>}
      {editingId && (
        <div className="edit-banner">
          Editing message
          <button type="button" className="link" onClick={cancelEdit}>Cancel</button>
        </div>
      )}
      <form className="composer" onSubmit={submit}>
        <input ref={fileInputRef} type="file" accept="image/*,video/*" hidden onChange={pickFile} />
        <button
          type="button"
          className="icon-btn attach-btn"
          title="Send a photo or video"
          disabled={uploading || !!editingId}
          onClick={() => fileInputRef.current.click()}
        >
          {uploading ? '…' : '📎'}
        </button>
        <input
          placeholder="Type a message…"
          value={text}
          onChange={(e) => { setText(e.target.value); onTyping(); }}
          autoFocus
        />
        <button type="submit">{editingId ? 'Update' : 'Send'}</button>
      </form>

      {preview && <Lightbox attachment={preview} onClose={() => setPreview(null)} />}
    </main>
  );
}
