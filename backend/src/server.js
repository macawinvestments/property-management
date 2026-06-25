import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { query } from './db/pool.js';
import { dealsRouter } from './routes/deals.js';

const app = express();

app.use(cors({ origin: config.allowedOrigin }));
app.use(express.json({ limit: '2mb' }));

app.use('/api/deals', dealsRouter);

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
  });
});

app.get('/', (_req, res) => {
  res.json({ service: 'Property Management API', health: '/api/health' });
});

app.listen(config.port, () => {
  console.log(`[startup] Property Management backend listening on :${config.port}`);
});
