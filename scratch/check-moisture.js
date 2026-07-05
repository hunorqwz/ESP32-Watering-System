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

  console.log('--- MOISTURE SENSOR CONFIGS ---');
  const configRes = await client.query("SELECT id, name, type, dry_limit, wet_limit FROM sensor_configs WHERE type = 'moisture'");
  console.log(configRes.rows);

  console.log('\n--- LATEST MOISTURE READINGS FOR SENSOR 1 ---');
  const readingRes = await client.query("SELECT * FROM sensor_readings WHERE sensor_config_id = 1 ORDER BY created_at DESC LIMIT 5");
  console.log(readingRes.rows);

  await client.end();
}

main();
