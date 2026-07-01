import express from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { query } from '../db/pool.js';
import { uploadObject, signedDownloadUrl, deleteObject, r2Configured } from '../storage/r2.js';

export const documentsRouter = express.Router();

// Keep uploads in memory (we stream straight to R2). 50MB cap.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Block executables / risky types; allow documents, images, office files.
const BLOCKED_EXT = ['exe', 'bat', 'cmd', 'sh', 'msi', 'com', 'scr', 'jar', 'app', 'dll', 'js', 'vbs'];
function extOf(name) {
  const m = /\.([^.]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

// LIST documents for a deal (optionally by category).
documentsRouter.get('/:dealId', async (req, res) => {
  try {
    const { category } = req.query;
    const params = [req.params.dealId];
    let sql = 'SELECT id, deal_id, category, filename, mime_type, size_bytes, uploaded_at FROM documents WHERE deal_id = $1';
    if (category) { sql += ' AND category = $2'; params.push(category); }
    sql += ' ORDER BY uploaded_at DESC';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[docs:list]', err.message);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// UPLOAD one or more files to a deal + category.
documentsRouter.post('/:dealId', upload.array('files', 20), async (req, res) => {
  if (!r2Configured()) return res.status(503).json({ error: 'File storage not configured' });
  try {
    const dealId = req.params.dealId;
    const category = (req.body.category || 'others').slice(0, 60);
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

    // Verify the deal exists (documents require a saved deal).
    const deal = await query('SELECT id FROM deals WHERE id = $1', [dealId]);
    if (!deal.rows.length) return res.status(404).json({ error: 'Deal not found' });

    const saved = [];
    for (const f of files) {
      if (BLOCKED_EXT.includes(extOf(f.originalname))) {
        return res.status(400).json({ error: `File type not allowed: ${f.originalname}` });
      }
      const key = `deals/${dealId}/${category}/${randomUUID()}-${f.originalname.replace(/[^\w.\-]/g, '_')}`;
      await uploadObject(key, f.buffer, f.mimetype);
      const { rows } = await query(
        `INSERT INTO documents (deal_id, category, filename, mime_type, size_bytes, storage_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, deal_id, category, filename, mime_type, size_bytes, uploaded_at`,
        [dealId, category, f.originalname, f.mimetype, f.size, key]
      );
      saved.push(rows[0]);
    }
    res.status(201).json(saved);
  } catch (err) {
    console.error('[docs:upload]', err.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// GET a signed URL to view/download one document.
documentsRouter.get('/file/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Document not found' });
    const doc = rows[0];
    const url = await signedDownloadUrl(doc.storage_key, doc.filename);
    res.json({ url, filename: doc.filename, mime_type: doc.mime_type });
  } catch (err) {
    console.error('[docs:url]', err.message);
    res.status(500).json({ error: 'Failed to get file URL' });
  }
});

// DELETE a document (from R2 and the table).
documentsRouter.delete('/file/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Document not found' });
    const doc = rows[0];
    try { await deleteObject(doc.storage_key); } catch (e) { console.error('[docs:r2del]', e.message); }
    await query('DELETE FROM documents WHERE id = $1', [req.params.id]);
    res.json({ ok: true, deleted: Number(req.params.id) });
  } catch (err) {
    console.error('[docs:delete]', err.message);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});
