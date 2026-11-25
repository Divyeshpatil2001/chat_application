export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// File uploads use multipart form data, not JSON, so this goes through fetch directly.
export async function uploadFile(token, file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data; // { url, type, name }
}

// Attachment URLs from the server are relative (e.g. /uploads/xyz.jpg); resolve against the API host.
export const mediaUrl = (url) => (url?.startsWith('/') ? `${API_URL}${url}` : url);
