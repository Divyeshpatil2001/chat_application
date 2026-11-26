import { lazy, Suspense } from 'react';

// emoji-picker-react is large, so it's split into its own chunk and only loaded the
// first time someone opens the picker.
const Picker = lazy(() => import('emoji-picker-react'));

export default function EmojiPicker({ theme, onPick, onClose }) {
  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div className="emoji-popover">
        <Suspense fallback={<div className="emoji-loading muted">Loading…</div>}>
          <Picker theme={theme} lazyLoadEmojis onEmojiClick={(data) => onPick(data.emoji)} width={320} height={380} />
        </Suspense>
      </div>
    </>
  );
}
