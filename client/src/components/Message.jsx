import { mediaUrl } from '../api.js';
import MessageText from './MessageText.jsx';

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

export function replyPreviewText(r) {
  if (!r || r.deleted) return 'Message unavailable';
  if (r.text) return r.text;
  if (r.attachmentType) return r.attachmentType === 'video' ? '🎥 Video' : '📷 Photo';
  return '';
}

function LinkPreview({ preview }) {
  return (
    <a className="link-preview" href={preview.url} target="_blank" rel="noopener noreferrer">
      {preview.image && <img src={preview.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => e.currentTarget.remove()} />}
      <div className="link-preview-body">
        <small className="muted">{preview.siteName}</small>
        <strong>{preview.title}</strong>
        {preview.description && <small className="link-preview-desc">{preview.description}</small>}
      </div>
    </a>
  );
}

// ✓ sent · ✓✓ delivered to every other member · blue ✓✓ read by every other member.
function Receipt({ message, members, myId }) {
  const others = members.filter((m) => m.id !== myId);
  if (!others.length) return null;
  const readBy = message.readBy || [];
  const deliveredTo = message.deliveredTo || [];
  const allRead = others.every((m) => readBy.includes(m.id));
  const allDelivered = others.every((m) => deliveredTo.includes(m.id));
  const names = (ids) => others.filter((m) => ids.includes(m.id)).map((m) => m.username).join(', ');
  const title = [
    readBy.length && `Read by ${names(readBy)}`,
    deliveredTo.length > readBy.length && `Delivered to ${names(deliveredTo.filter((id) => !readBy.includes(id)))}`,
  ].filter(Boolean).join(' · ') || 'Sent';
  return (
    <span className={`receipt ${allRead ? 'read' : ''}`} title={title}>
      {allRead || allDelivered ? '✓✓' : '✓'}
    </span>
  );
}

export default function Message({ message: m, user, conversation, onMenu, onPreview, onReact, onJumpTo }) {
  const mine = m.senderId === user.id;
  const isGroup = conversation.type === 'group';
  const members = conversation.members;
  const mentionsMe = !mine && m.mentions?.includes(user.id);
  const nameOf = (id) => (id === user.id ? 'You' : members.find((x) => x.id === id)?.username || 'Someone');
  const reactions = Object.entries(m.reactions || {});

  return (
    <div id={`msg-${m.id}`} className={`msg ${mine ? 'mine' : ''} ${mentionsMe ? 'mentioned' : ''}`}>
      {isGroup && !mine && !m.deleted && <div className="sender">{m.senderName}</div>}
      {!m.deleted && (
        <button className="icon-btn msg-menu-btn" title="Message options" onClick={(e) => onMenu(e, m)}>⋮</button>
      )}
      {m.deleted ? (
        <div className="deleted-text">🚫 This message was deleted</div>
      ) : (
        <>
          {m.replyTo && (
            <button type="button" className="reply-quote" onClick={() => onJumpTo(m.replyTo.id)}>
              <strong>{m.replyTo.senderId === user.id ? 'You' : m.replyTo.senderName}</strong>
              <span className="ellipsis">{replyPreviewText(m.replyTo)}</span>
            </button>
          )}
          {m.attachment && <Attachment attachment={m.attachment} onPreview={onPreview} />}
          {m.text && <MessageText text={m.text} members={members} myId={user.id} />}
          {m.linkPreview && <LinkPreview preview={m.linkPreview} />}
        </>
      )}
      <div className="time">
        {m.editedAt && !m.deleted && <span className="edited-tag">edited · </span>}
        {time(m.createdAt)}
        {mine && !m.deleted && <Receipt message={m} members={members} myId={user.id} />}
      </div>
      {!m.deleted && reactions.length > 0 && (
        <div className="reactions">
          {reactions.map(([emoji, ids]) => (
            <button
              key={emoji}
              type="button"
              className={`reaction ${ids.includes(user.id) ? 'mine' : ''}`}
              title={ids.map(nameOf).join(', ')}
              onClick={() => onReact(m.id, emoji)}
            >
              {emoji} {ids.length}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
