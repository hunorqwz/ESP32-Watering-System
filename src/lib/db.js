import { neon } from '@neondatabase/serverless';

let cachedSql = null;

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is missing.');
  }
  if (!cachedSql) {
    cachedSql = neon(databaseUrl);
  }
  return cachedSql;
}
