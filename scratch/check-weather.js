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

const connectionString = config.DATABASE_URL;

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  console.log('--- SYSTEM CONFIG LOCATION DATA ---');
  const configRes = await client.query(
    "SELECT * FROM system_config WHERE key IN ('latitude', 'longitude', 'location_name')"
  );
  console.log(configRes.rows);

  console.log('\n--- WEATHER CACHE DATA ---');
  const cacheRes = await client.query(
    "SELECT forecast_date, precipitation_probability, expected_precipitation_mm, raw_payload, updated_at FROM weather_forecast_cache ORDER BY forecast_date ASC LIMIT 5"
  );
  console.log(cacheRes.rows);

  await client.end();
}

main();
