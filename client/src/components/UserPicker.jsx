import { useState } from 'react';

// Modal for choosing people: used for creating a group and adding people to one.
export default function UserPicker({ title, users, askName, onSubmit, onClose }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function submit(e) {
    e.preventDefault();
    if (askName && !name.trim()) return setError('Enter a group name');
    if (selected.length === 0) return setError('Select at least one person');
    try {
      await onSubmit(name.trim(), selected);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{title}</h3>
        {askName && <input placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
        <div className="picker">
          {users.length === 0 && <p className="muted">No one left to add.</p>}
          {users.map((u) => (
            <label key={u.id} className="row">
              <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
              <span className="grow">{u.username}</span>
              <span className={`dot ${u.online ? 'on' : ''}`} />
            </label>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row end">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit">{askName ? 'Create group' : `Add ${selected.length || ''}`}</button>
        </div>
      </form>
    </div>
  );
}
