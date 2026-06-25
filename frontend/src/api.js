// Talks to the backend. Base URL comes from VITE_API_URL (localhost in dev,
// the Railway URL in production).
const API = import.meta.env.VITE_API_URL || 'http://localhost:8080';

async function handle(res) {
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
  listDeals: () => fetch(`${API}/api/deals`).then(handle),

  getDeal: (id) => fetch(`${API}/api/deals/${id}`).then(handle),

  createDeal: (data, status = 'active') =>
    fetch(`${API}/api/deals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, status }),
    }).then(handle),

  updateDeal: (id, data, status) =>
    fetch(`${API}/api/deals/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, status }),
    }).then(handle),

  setStatus: (id, status) =>
    fetch(`${API}/api/deals/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).then(handle),

  deleteDeal: (id) =>
    fetch(`${API}/api/deals/${id}`, { method: 'DELETE' }).then(handle),
};
