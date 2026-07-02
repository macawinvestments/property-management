import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { signedDownloadUrl } from '../storage/r2.js';

export const extractRouter = express.Router();

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

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

// POST /api/extract/:dealId  { documentId }  — extract from a stored R2 doc.
extractRouter.post('/:dealId', async (req, res) => {
  if (!anthropicConfigured()) {
    return res.status(503).json({ error: 'Extraction not configured (missing ANTHROPIC_API_KEY)' });
  }
  const { dealId } = req.params;
  const { documentId } = req.body || {};
  if (!documentId) return res.status(400).json({ error: 'documentId is required' });

  try {
    // Load the document metadata.
    const docRes = await query('SELECT * FROM documents WHERE id = $1 AND deal_id = $2', [documentId, dealId]);
    if (!docRes.rows.length) return res.status(404).json({ error: 'Document not found for this deal' });
    const doc = docRes.rows[0];
    const isPdf = (doc.mime_type || '').includes('pdf') || (doc.filename || '').toLowerCase().endsWith('.pdf');
    if (!isPdf) return res.status(400).json({ error: 'Extraction currently supports PDF documents only' });

    // Fetch the file bytes from R2 (via a signed URL) and base64-encode.
    const url = await signedDownloadUrl(doc.storage_key, doc.filename, 120);
    const fileResp = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!fileResp.ok) throw new Error(`Could not fetch document (${fileResp.status})`);
    const buf = Buffer.from(await fileResp.arrayBuffer());
    const base64 = buf.toString('base64');

    // Load the schema.
    const schemaRes = await query('SELECT field_key, label, field_type, extract FROM schema_fields ORDER BY sort_order, id');
    const prompt = buildPrompt(schemaRes.rows);

    // Call Claude with the PDF + extraction instructions. Use STREAMING —
    // large PDFs take long enough that a non-streamed request can have its
    // connection dropped ("premature close"), especially behind a host like
    // Railway. Streaming keeps the connection alive and assembles the text.
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

    // Parse the JSON response (strip any accidental fences).
    const text = (message.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .replace(/```json|```/g, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: 'Model returned unparseable output', raw: text.slice(0, 500) });
    }
    const known = parsed.known_fields || {};
    const extras = Array.isArray(parsed.extra_facts) ? parsed.extra_facts : [];

    // Store the extraction result (nothing lost).
    const ins = await query(
      `INSERT INTO extractions (deal_id, document_id, source_name, known_fields, extra_facts)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
      [dealId, documentId, doc.filename, JSON.stringify(known), JSON.stringify(extras)]
    );

    res.json({
      extractionId: ins.rows[0].id,
      sourceName: doc.filename,
      documentId: Number(documentId),
      knownFields: known,
      extraFacts: extras,
      createdAt: ins.rows[0].created_at,
    });
  } catch (err) {
    console.error('[extract:run]', err.message);
    res.status(502).json({ error: 'Extraction failed', detail: err.message });
  }
});

// GET /api/extract/:dealId/history — past extractions for a deal.
extractRouter.get('/:dealId/history', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, document_id, source_name, known_fields, extra_facts, created_at FROM extractions WHERE deal_id = $1 ORDER BY created_at DESC',
      [req.params.dealId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[extract:history]', err.message);
    res.status(500).json({ error: 'Failed to load extraction history' });
  }
});
