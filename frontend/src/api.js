const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
let token = localStorage.getItem('icedistribution-token');

export function setToken(nextToken) {
  token = nextToken;
  if (nextToken) localStorage.setItem('icedistribution-token', nextToken);
  else localStorage.removeItem('icedistribution-token');
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error('Tidak dapat terhubung ke server. Pastikan API backend sedang berjalan.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Permintaan tidak dapat diproses.');
  return data;
}

export function getToken() {
  return token;
}
