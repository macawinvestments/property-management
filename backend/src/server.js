import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { query } from './db/pool.js';
import { dealsRouter } from './routes/deals.js';
import { documentsRouter } from './routes/documents.js';
import { enrichRouter } from './routes/enrich.js';
import { requirePassword } from './middleware/auth.js';

const app = express();

app.use(cors({
  origin: config.allowedOrigin,
  allowedHeaders: ['Content-Type', 'x-app-password'],
}));
app.use(express.json({ limit: '2mb' }));

// Login check — frontend posts the password here to verify before unlocking.
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === config.appPassword) {
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: 'Incorrect password' });
});

// Deals routes require the password header on every request.
app.use('/api/deals', requirePassword, dealsRouter);

// Documents routes also require the password.
app.use('/api/documents', requirePassword, documentsRouter);

// Property-data enrichment (FEMA flood, later Census/Regrid). Password-protected.
app.use('/api/enrich', requirePassword, enrichRouter);

// Health check — proves the server is up and tests the actual DB connection.
app.get('/api/health', async (_req, res) => {
  let dbConnected = false;
  try {
    await query('SELECT 1');
    dbConnected = true;
  } catch {
    dbConnected = false;
  }
  res.json({
    ok: true,
    service: 'property-management-backend',
    time: new Date().toISOString(),
    dbConfigured: Boolean(config.databaseUrl),
    dbConnected,
    r2Configured: Boolean(config.r2.accountId && config.r2.accessKeyId && config.r2.secretAccessKey),
  });
});

app.get('/', (_req, res) => {
  res.json({ service: 'Property Management API', health: '/api/health' });
});

app.listen(config.port, () => {
  console.log(`[startup] Property Management backend listening on :${config.port}`);
});
