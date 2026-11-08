import { runner } from 'node-pg-migrate';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await runner({
      dbClient: client,
      migrationsTable: 'pgmigrations',
      dir: join(__dirname, '..', 'migrations'),
      direction: 'up',
      count: Infinity,
      logger: console,
    });
  } finally {
    client.release();
  }
}
