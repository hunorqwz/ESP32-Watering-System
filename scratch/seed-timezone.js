import { Client } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const config = {};
env.split('\n').forEach(l => {
  const parts = l.split('=');
  if (parts.length >= 2) {
    config[parts[0].trim()] = parts.slice(1).join('=').trim();
  }
});

async function main() {
  const client = new Client({ connectionString: config.DATABASE_URL });
  await client.connect();
  await client.query("INSERT INTO system_config (key, value) VALUES ('timezone', 'Europe/Bucharest') ON CONFLICT (key) DO NOTHING");
  await client.end();
  console.log('Timezone seeded successfully.');
}

main();
