import express from 'express';
import { query } from '../db/pool.js';

export const dealsRouter = express.Router();

// Pull the few list-columns out of the full deal state so the pipeline can
// sort/filter without parsing JSON. We read these from the saved input state.
function extract(data) {
  const name = data?.deal?.name ?? '';
  const address = data?.deal?.address ?? '';
  // purchase price = asking × offer% (mirrors the frontend calc); stored for the list.
  const asking = Number(data?.deal?.askingPrice) || 0;
  const offerPct = Number(data?.deal?.offerPct) || 0;
  const purchasePrice = asking * (offerPct / 100);
  const irr = data?.summary?.irr != null ? Number(data.summary.irr) : null;
  return { name, address, purchasePrice, irr };
}

// LIST — all deals, newest first. Returns list columns only (not full data).
dealsRouter.get('/', async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, address, status, purchase_price, irr, created_at, updated_at
       FROM deals ORDER BY updated_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[deals:list]', err.message);
    res.status(500).json({ error: 'Failed to list deals' });
  }
});

// GET ONE — full deal state, to reopen and restore exactly.
dealsRouter.get('/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM deals WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Deal not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[deals:get]', err.message);
    res.status(500).json({ error: 'Failed to load deal' });
  }
});

// CREATE — save a new deal. Body: { data: <full input state>, status? }
dealsRouter.post('/', async (req, res) => {
  try {
    const { data, status } = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Missing deal data' });
    }
    const { name, address, purchasePrice, irr } = extract(data);
    const { rows } = await query(
      `INSERT INTO deals (name, address, status, purchase_price, irr, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, address, status, purchase_price, irr, created_at, updated_at`,
      [name, address, status || 'active', purchasePrice, irr, data]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[deals:create]', err.message);
    res.status(500).json({ error: 'Failed to save deal' });
  }
});

// UPDATE — overwrite an existing deal's data (and re-extract list columns).
dealsRouter.put('/:id', async (req, res) => {
  try {
    const { data, status } = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Missing deal data' });
    }
    const { name, address, purchasePrice, irr } = extract(data);
    const { rows } = await query(
      `UPDATE deals
       SET name = $1, address = $2, purchase_price = $3, irr = $4, data = $5,
           status = COALESCE($6, status), updated_at = now()
       WHERE id = $7
       RETURNING id, name, address, status, purchase_price, irr, created_at, updated_at`,
      [name, address, purchasePrice, irr, data, status || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Deal not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[deals:update]', err.message);
    res.status(500).json({ error: 'Failed to update deal' });
  }
});

// STATUS — change just the status (active | accepted | declined).
dealsRouter.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['active', 'accepted', 'declined'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const { rows } = await query(
      `UPDATE deals SET status = $1, updated_at = now() WHERE id = $2
       RETURNING id, name, address, status, purchase_price, irr, created_at, updated_at`,
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Deal not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[deals:status]', err.message);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// DELETE — remove a deal.
dealsRouter.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM deals WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Deal not found' });
    res.json({ ok: true, deleted: Number(req.params.id) });
  } catch (err) {
    console.error('[deals:delete]', err.message);
    res.status(500).json({ error: 'Failed to delete deal' });
  }
});
