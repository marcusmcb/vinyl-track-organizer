import pg from 'pg';

const { Pool } = pg;

export type Pool = pg.Pool;

export function createPool(connectionString?: string): pg.Pool {
  const conn = connectionString ?? process.env.DATABASE_URL;
  if (!conn) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and configure your local PostgreSQL connection.'
    );
  }
  return new Pool({ connectionString: conn });
}
