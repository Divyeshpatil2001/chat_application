import { useEffect, useState } from 'react';
import { api } from './api.js';
import { requestNotificationPermission } from './notifications.js';
import Auth from './components/Auth.jsx';
import Chat from './components/Chat.jsx';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (!token) return;
    api('/me', { token })
      .then(setUser)
      .catch(() => logout());
  }, [token]);

  function login({ token, user }) {
    localStorage.setItem('token', token);
    setToken(token);
    setUser(user);
    // Ask right after login. Browsers that only allow this on a direct click fall back to the 🔔 button in the sidebar.
    requestNotificationPermission();
  }

  function logout() {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }

  if (!token) return <Auth onAuth={login} />;
  if (!user) return <div className="center">Loading…</div>;
  return <Chat token={token} user={user} onLogout={logout} />;
}
