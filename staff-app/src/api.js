import { API_BASE } from './lib/config.js';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  if (!isJson) {
    throw new Error(`API unavailable (${res.status})`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  getItems: () => request('/items'),
  getFormulas: () => request('/formulas'),
  saveWeighing: (payload) =>
    request('/weighings', { method: 'POST', body: JSON.stringify(payload) }),
};