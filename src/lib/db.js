import { neon } from '@neondatabase/serverless';

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is missing.');
  }
  return neon(databaseUrl, {
    fetchOptions: {
      signal: AbortSignal.timeout(15000) // Fresh timeout signal per database request
    }
  });
}
