// Thin wrapper around the browser Notification API.
export const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window;

export const notificationPermission = () => (notificationsSupported ? Notification.permission : 'denied');

// Browsers only show the prompt while permission is still 'default'. Some (Safari, Firefox)
// also require a user gesture, which is why there's a manual "enable" button as a fallback.
export async function requestNotificationPermission() {
  if (!notificationsSupported || Notification.permission !== 'default') return notificationPermission();
  try {
    return await Notification.requestPermission();
  } catch {
    return notificationPermission();
  }
}

// `tag` collapses duplicates, e.g. when the same user has the app open in two tabs.
export function notify({ title, body, tag, onClick }) {
  if (notificationPermission() !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    // Some mobile browsers only allow notifications from a service worker; ignore there.
  }
}
