const API_BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
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
  getRecipes: () => request('/recipes'),
  createRecipe: (payload) =>
    request('/recipes', { method: 'POST', body: JSON.stringify(payload) }),
  updateRecipe: (id, payload) =>
    request(`/recipes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteRecipe: (id) => request(`/recipes/${id}`, { method: 'DELETE' }),
  getOverview: () => request('/reports/overview'),
  getMonthlyReport: (year, month) =>
    request(`/reports/monthly?year=${year}&month=${month}`),
  getYearlyReport: (year) => request(`/reports/yearly?year=${year}`),
};