import { useEffect, useRef, useState } from 'react';
import Lightbox from './Lightbox.jsx';
import Message, { replyPreviewText } from './Message.jsx';
import EmojiPicker from './EmojiPicker.jsx';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export default function ChatWindow({ user, users, conversation, messages, typing, theme, onSend, onSendFile, onDeleteMessage, onEditMessage, onReact, onTyping, onAddPeople, onLeave, onClose }) {
  const [text, setText] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const [menu, setMenu] = useState(null); // { message, x, y } | null — screen coords, so it floats above everything
  const [preview, setPreview] = useState(null); // attachment being shown full-screen, or null
  const [editingId, setEditingId] = useState(null);
  const [replyTo, setReplyTo] = useState(null); // message being replied to, or null
  const [picker, setPicker] = useState(null); // null | { target: 'composer' } | { target: 'reaction', messageId }
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);

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
    setReplyTo(null);
    setPicker(null);
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
      onSend(text, replyTo?.id);
      setReplyTo(null);
    }
    setText('');
  }

  function startEdit(message) {
    setMenu(null);
    setReplyTo(null);
    setEditingId(message.id);
    setText(message.text || '');
    inputRef.current?.focus();
  }

  function cancelEdit() {
    setEditingId(null);
    setText('');
  }

  function startReply(message) {
    setMenu(null);
    if (editingId) cancelEdit();
    setReplyTo(message);
    inputRef.current?.focus();
  }

  function react(messageId, emoji) {
    setMenu(null);
    onReact(messageId, emoji);
  }

  // Inserts at the caret instead of appending, then puts the caret after the emoji.
  function insertEmoji(emoji) {
    const input = inputRef.current;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  function pickEmoji(emoji) {
    if (picker?.target === 'reaction') {
      onReact(picker.messageId, emoji);
      setPicker(null);
    } else insertEmoji(emoji);
  }

  function jumpTo(messageId) {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation if it's already running
    el.classList.add('flash');
  }

  async function pickFile(e) {
    const file = e.target.files[0];
    e.target.value = ''; // allow picking the same file again later
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      await onSendFile(file, replyTo?.id);
      setReplyTo(null);
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
              <Message
                key={m.id}
                message={m}
                user={user}
                conversation={conversation}
                onMenu={openMenu}
                onPreview={setPreview}
                onReact={onReact}
                onJumpTo={jumpTo}
              />
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
          <div className="msg-menu" style={{ top: Math.min(menu.y + 4, window.innerHeight - 230), left: Math.max(8, menu.x - 230) }}>
            <div className="quick-reactions">
              {QUICK_REACTIONS.map((emoji) => (
                <button key={emoji} title={`React ${emoji}`} onClick={() => react(menu.message.id, emoji)}>{emoji}</button>
              ))}
              <button
                title="More reactions"
                onClick={() => {
                  setPicker({ target: 'reaction', messageId: menu.message.id });
                  setMenu(null);
                }}
              >
                ＋
              </button>
            </div>
            <button onClick={() => startReply(menu.message)}>Reply</button>
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
      {replyTo && (
        <div className="reply-banner">
          <div className="grow">
            <strong>Replying to {replyTo.senderId === user.id ? 'yourself' : replyTo.senderName}</strong>
            <small className="muted ellipsis">{replyPreviewText({ text: replyTo.text, attachmentType: replyTo.attachment?.type })}</small>
          </div>
          <button type="button" className="icon-btn" title="Cancel reply" onClick={() => setReplyTo(null)}>✕</button>
        </div>
      )}
      {picker && <EmojiPicker theme={theme} onPick={pickEmoji} onClose={() => setPicker(null)} />}
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
        <button
          type="button"
          className="icon-btn attach-btn"
          title="Insert emoji"
          onClick={() => setPicker((p) => (p?.target === 'composer' ? null : { target: 'composer' }))}
        >
          😊
        </button>
        <input
          ref={inputRef}
          placeholder="Type a message…"
          value={text}
          onChange={(e) => { setText(e.target.value); onTyping(); }}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            if (editingId) cancelEdit();
            else setReplyTo(null);
          }}
          autoFocus
        />
        <button type="submit">{editingId ? 'Update' : 'Send'}</button>
      </form>
      {preview && <Lightbox attachment={preview} onClose={() => setPreview(null)} />}
    </main>
  );
}
