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

  // ---- Documents ----
  listDocuments: (dealId, category) => {
    const q = category ? `?category=${encodeURIComponent(category)}` : '';
    return fetch(`${API}/api/documents/${dealId}${q}`, { headers: authHeaders() }).then(handle);
  },

  // Upload files (FormData). Do NOT set Content-Type — the browser sets the
  // multipart boundary automatically. Password header still required.
  uploadDocuments: (dealId, category, files) => {
    const form = new FormData();
    form.append('category', category);
    for (const f of files) form.append('files', f);
    return fetch(`${API}/api/documents/${dealId}`, {
      method: 'POST',
      headers: { 'x-app-password': getPassword() },
      body: form,
    }).then(handle);
  },

  // Get a short-lived signed URL to view/download a file.
  getDocumentUrl: (docId) =>
    fetch(`${API}/api/documents/file/${docId}`, { headers: authHeaders() }).then(handle),

  deleteDocument: (docId) =>
    fetch(`${API}/api/documents/file/${docId}`, { method: 'DELETE', headers: authHeaders() }).then(handle),

  // ---- Property-data enrichment ----
  getFloodZone: (lat, lng) =>
    fetch(`${API}/api/enrich/flood`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ lat, lng }),
    }).then(handle),

  getDemographics: (lat, lng) =>
    fetch(`${API}/api/enrich/demographics`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ lat, lng }),
    }).then(handle),

  getParcel: (lat, lng) =>
    fetch(`${API}/api/enrich/parcel`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ lat, lng }),
    }).then(handle),
};
