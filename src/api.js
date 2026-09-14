const API_BASE = '/api';

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
  createItem: (payload) =>
    request('/items', { method: 'POST', body: JSON.stringify(payload) }),
  deleteItem: (id) => request(`/items/${id}`, { method: 'DELETE' }),
  saveWeighing: (payload) =>
    request('/weighings', { method: 'POST', body: JSON.stringify(payload) }),
  getWeighings: () => request('/weighings'),
  getWeighing: (id) => request(`/weighings/${id}`),
  getFormulas: () => request('/formulas'),
  createFormula: (payload) =>
    request('/formulas', { method: 'POST', body: JSON.stringify(payload) }),
  updateFormula: (id, payload) =>
    request(`/formulas/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteFormula: (id) => request(`/formulas/${id}`, { method: 'DELETE' }),
  getOverview: () => request('/reports/overview'),
  getMonthlyReport: (year, month) =>
    request(`/reports/monthly?year=${year}&month=${month}`),
  getYearlyReport: (year) => request(`/reports/yearly?year=${year}`),
};