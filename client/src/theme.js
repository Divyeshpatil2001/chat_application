import { useEffect, useState } from 'react';

// Theme preference: 'light' | 'dark' | 'system'. "system" follows prefers-color-scheme.
// The choice lives on <html data-theme>, which styles.css keys its CSS variables off.
const KEY = 'theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

const readPreference = () => {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
};

function apply(pref) {
  if (pref === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
}

// Called once before React renders, so the page never flashes the wrong theme.
export function applyStoredTheme() {
  apply(readPreference());
}

export function useTheme() {
  const [preference, setPreference] = useState(readPreference);
  const [systemDark, setSystemDark] = useState(media.matches);

  useEffect(() => {
    const onChange = (e) => setSystemDark(e.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  function choose(pref) {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
    apply(pref);
    setPreference(pref);
  }

  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  return { preference, resolved, choose };
}
