import { useState } from 'react';

// Full-screen preview for a sent photo/video, with a real "Save As" download
// (fetches the bytes and triggers a blob download, which works even though the
// media is served from a different origin/port than the page).
export default function Lightbox({ attachment, onClose }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  async function download() {
    setError('');
    setDownloading(true);
    try {
      const res = await fetch(attachment.url);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = attachment.name || 'file';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      setError('Could not download this file');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox" onClick={(e) => e.stopPropagation()}>
        <header className="lightbox-head">
          <span className="ellipsis">{attachment.name || (attachment.type === 'video' ? 'Video' : 'Photo')}</span>
          <div className="row">
            <button className="secondary" disabled={downloading} onClick={download}>
              {downloading ? 'Downloading…' : '⬇ Download'}
            </button>
            <a className="secondary link-btn" href={attachment.url} target="_blank" rel="noreferrer">Open in new tab</a>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
        </header>
        {error && <p className="error">{error}</p>}
        <div className="lightbox-body">
          {attachment.type === 'video' ? (
            <video src={attachment.url} controls autoPlay className="lightbox-media" />
          ) : (
            <img src={attachment.url} alt={attachment.name || 'photo'} className="lightbox-media" />
          )}
        </div>
      </div>
    </div>
  );
}
