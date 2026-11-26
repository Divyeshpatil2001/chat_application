// Renders message text with clickable links and highlighted @mentions.
// Everything is emitted as React elements (never raw HTML), so message text can't inject markup.
const TOKEN = /(https?:\/\/[^\s<>"']+)|(@[a-zA-Z0-9_]{3,20})(?![\w])/gi;
const TRAILING_PUNCTUATION = /[.,!?;:)\]]+$/;

export default function MessageText({ text, members, myId }) {
  const byName = new Map(members.map((m) => [m.username.toLowerCase(), m]));
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    let [token, url, mention] = match;
    const start = match.index;
    // A mention must start a word: skip "email@example" style matches.
    if (mention && start > 0 && /[\w@]/.test(text[start - 1])) continue;
    if (url) {
      const trailing = url.match(TRAILING_PUNCTUATION)?.[0] || '';
      token = url.slice(0, url.length - trailing.length);
    }
    const member = mention && byName.get(mention.slice(1).toLowerCase());
    if (mention && !member) continue; // not a member: leave as plain text
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      url ? (
        <a key={start} href={token} target="_blank" rel="noopener noreferrer">{token}</a>
      ) : (
        <span key={start} className={`mention ${member.id === myId ? 'me' : ''}`}>{token}</span>
      )
    );
    last = start + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <div className="msg-text">{parts}</div>;
}
