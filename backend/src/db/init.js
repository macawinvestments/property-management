import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function init() {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(schema);
    console.log('[initdb] Schema applied successfully — deals table ready.');
  } catch (err) {
    console.error('[initdb] Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

init();
