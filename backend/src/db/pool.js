import pg from 'pg';
import { config } from '../config.js';

// Railway's Postgres requires SSL; local dev usually doesn't. We enable SSL
// when the connection string looks remote (contains a host that isn't localhost).
const isLocal = config.databaseUrl.includes('localhost') || config.databaseUrl.includes('127.0.0.1');

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

export function query(text, params) {
  return pool.query(text, params);
}
