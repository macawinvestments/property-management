import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { signedDownloadUrl } from '../storage/r2.js';

export const extractRouter = express.Router();

const anthropic = new Anthropic({
  apiKey: config.anthropicApiKey,
  timeout: 10 * 60 * 1000, // 10 minutes — large PDFs take a while
  maxRetries: 3,           // retry transient connection drops
});

function anthropicConfigured() {
  return Boolean(config.anthropicApiKey);
}

// GET /api/extract/schema — the current field list (for the Overview UI).
extractRouter.get('/schema', async (_req, res) => {
  try {
    const { rows } = await query(
      'SELECT field_key, label, field_type, destination, extract, sort_order FROM schema_fields ORDER BY sort_order, id'
    );
    res.json(rows);
  } catch (err) {
    console.error('[extract:schema]', err.message);
    res.status(500).json({ error: 'Failed to load schema' });
  }
});

// Build the extraction instruction from the extractable schema fields.
function buildPrompt(fields) {
  const lines = fields
    .filter((f) => f.extract)
    .map((f) => `- ${f.field_key} (${f.field_type}): ${f.label}`)
    .join('\n');

  return `You are a commercial real-estate document extraction assistant. You will be given a document (an offering memorandum, listing, or similar). Extract ONLY facts that are explicitly stated in the document.

Extract these known fields:
${lines}

Rules:
- Return ONLY valid JSON, no prose, no markdown fences.
- For each known field you find, give: the value, the page number, and the exact source text you read it from.
- If a field is NOT explicitly stated in the document, OMIT it (do not guess, do not derive, do not infer).
- Numbers: return raw numbers without currency symbols or commas (e.g. 5175000 not "$5,175,000"). Percents as numbers (e.g. 6.9 not "6.90%").
- ALSO report any additional useful CRE facts you find that are NOT in the known-fields list, under "extra_facts".
- Be careful with occupancy: an "open shell" / vacant / "delivered vacant" property is NOT 100% occupied.

Return exactly this JSON shape:
{
  "known_fields": {
    "<field_key>": { "value": <value>, "page": <number>, "source_text": "<exact text>" }
  },
  "extra_facts": [
    { "label": "<short label>", "value": <value>, "type": "text|number|currency|percent|date", "page": <number>, "source_text": "<exact text>" }
  ]
}`;
}

// The heavy lifting: fetch PDF, call Claude, store results. Runs in the
// BACKGROUND (not awaited by the HTTP request) so Railway's request timeout
// can't kill it — the request already returned.
async function runExtractionJob(extractionId, dealId, doc) {
  try {
    const url = await signedDownloadUrl(doc.storage_key, doc.filename, 120);
    const fileResp = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!fileResp.ok) throw new Error(`Could not fetch document (${fileResp.status})`);
    const buf = Buffer.from(await fileResp.arrayBuffer());
    const base64 = buf.toString('base64');

    const schemaRes = await query('SELECT field_key, label, field_type, extract FROM schema_fields ORDER BY sort_order, id');
    const prompt = buildPrompt(schemaRes.rows);

    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    const message = await stream.finalMessage();

    const text = (message.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .replace(/```json|```/g, '')
      .trim();

    let parsed;
    try { parsed = JSON.parse(text); }
    catch { throw new Error('Model returned unparseable output'); }

    const known = parsed.known_fields || {};
    const extras = Array.isArray(parsed.extra_facts) ? parsed.extra_facts : [];

    await query(
      `UPDATE extractions SET status='done', known_fields=$1, extra_facts=$2, error_detail=NULL WHERE id=$3`,
      [JSON.stringify(known), JSON.stringify(extras), extractionId]
    );
    console.log(`[extract:done] extraction ${extractionId} completed`);
  } catch (err) {
    console.error('[extract:job]', err.message);
    await query(`UPDATE extractions SET status='error', error_detail=$1 WHERE id=$2`, [err.message, extractionId]);
  }
}

// POST /api/extract/:dealId  { documentId } — START extraction. Returns
// immediately with a pending extractionId; the work runs in the background.
extractRouter.post('/:dealId', async (req, res) => {
  if (!anthropicConfigured()) {
    return res.status(503).json({ error: 'Extraction not configured (missing ANTHROPIC_API_KEY)' });
  }
  const { dealId } = req.params;
  const { documentId } = req.body || {};
  if (!documentId) return res.status(400).json({ error: 'documentId is required' });

  try {
    const docRes = await query('SELECT * FROM documents WHERE id = $1 AND deal_id = $2', [documentId, dealId]);
    if (!docRes.rows.length) return res.status(404).json({ error: 'Document not found for this deal' });
    const doc = docRes.rows[0];
    const isPdf = (doc.mime_type || '').includes('pdf') || (doc.filename || '').toLowerCase().endsWith('.pdf');
    if (!isPdf) return res.status(400).json({ error: 'Extraction currently supports PDF documents only' });

    // Create a pending record and return its id immediately.
    const ins = await query(
      `INSERT INTO extractions (deal_id, document_id, source_name, status)
       VALUES ($1,$2,$3,'pending') RETURNING id, created_at`,
      [dealId, documentId, doc.filename]
    );
    const extractionId = ins.rows[0].id;

    // Kick off the work WITHOUT awaiting — Railway keeps the Node process
    // alive, so this continues after we respond. No open request to time out.
    runExtractionJob(extractionId, dealId, doc);

    res.status(202).json({ extractionId, status: 'pending', sourceName: doc.filename });
  } catch (err) {
    console.error('[extract:start]', err.message);
    res.status(500).json({ error: 'Could not start extraction', detail: err.message });
  }
});

// GET /api/extract/status/:extractionId — poll for result.
extractRouter.get('/status/:extractionId', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, status, source_name, known_fields, extra_facts, error_detail FROM extractions WHERE id = $1',
      [req.params.extractionId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Extraction not found' });
    const e = rows[0];
    res.json({
      extractionId: e.id,
      status: e.status,
      sourceName: e.source_name,
      knownFields: e.known_fields || {},
      extraFacts: e.extra_facts || [],
      errorDetail: e.error_detail || null,
    });
  } catch (err) {
    console.error('[extract:status]', err.message);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// GET /api/extract/:dealId/history — past extractions for a deal.
extractRouter.get('/:dealId/history', async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT id, document_id, source_name, known_fields, extra_facts, created_at FROM extractions WHERE deal_id = $1 AND status = 'done' ORDER BY created_at DESC",
      [req.params.dealId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[extract:history]', err.message);
    res.status(500).json({ error: 'Failed to load extraction history' });
  }
});
