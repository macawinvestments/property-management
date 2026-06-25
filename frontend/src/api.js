// Talks to the backend. Base URL comes from VITE_API_URL (localhost in dev,
// the Railway URL in production).
const API = import.meta.env.VITE_API_URL || 'http://localhost:8080';

const STORAGE_KEY = 'otima_app_password';

// The saved password (persists across sessions on this device).
export function getPassword() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}
export function setPassword(pw) {
  try {
    localStorage.setItem(STORAGE_KEY, pw);
  } catch {
    /* ignore */
  }
}
export function clearPassword() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function authHeaders(extra = {}) {
  return { ...extra, 'x-app-password': getPassword() };
}

async function handle(res) {
  if (res.status === 401) {
    clearPassword();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  login: (password) =>
    fetch(`${API}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }).then((res) => res.ok),

  listDeals: () => fetch(`${API}/api/deals`, { headers: authHeaders() }).then(handle),

  getDeal: (id) => fetch(`${API}/api/deals/${id}`, { headers: authHeaders() }).then(handle),

  createDeal: (data, status = 'active') =>
    fetch(`${API}/api/deals`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ data, status }),
    }).then(handle),

  updateDeal: (id, data, status) =>
    fetch(`${API}/api/deals/${id}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ data, status }),
    }).then(handle),

  setStatus: (id, status) =>
    fetch(`${API}/api/deals/${id}/status`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status }),
    }).then(handle),

  deleteDeal: (id) =>
    fetch(`${API}/api/deals/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle),
};
