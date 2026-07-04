import fs from 'fs';
import path from 'path';
import { Client } from '@neondatabase/serverless';
import { execSync } from 'child_process';

// Setup/Load .env file manually
try {
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of envLines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        if (val.endsWith('\r')) val = val.slice(0, -1);
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
} catch (err) {
  console.warn('Could not read .env file:', err);
}

const databaseUrl = process.env.DATABASE_URL;

async function runTest() {
  console.log('--- STARTING CONFIGURATION PRESERVATION TEST ---');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  // 1. Delete Pump 3 and Pump 4 to simulate user action
  console.log('Deleting Pump 3 and Pump 4 from the database...');
  await client.query('DELETE FROM pump_configs WHERE name IN ($1, $2)', ['Pump 3', 'Pump 4']);

  // 2. Query to verify they are gone
  let res = await client.query('SELECT name FROM pump_configs');
  console.log('Current pumps in DB:', res.rows.map(r => r.name));

  // 3. Run db-init.js (simulates server check-in/restart/deployment)
  console.log('\nRunning db-init.js without flags...');
  execSync('node scripts/db-init.js');

  // 4. Query again to check if Pump 3 and Pump 4 were re-seeded/restored
  res = await client.query('SELECT name FROM pump_configs');
  const pumpNames = res.rows.map(r => r.name);
  console.log('Pumps in DB after db-init.js:', pumpNames);

  const containsPump3 = pumpNames.includes('Pump 3');
  const containsPump4 = pumpNames.includes('Pump 4');

  if (!containsPump3 && !containsPump4) {
    console.log('\nResult: SUCCESS (Custom deletions were preserved!)');
  } else {
    console.error('\nResult: FAILURE (Pumps were restored by db-init.js!)');
    await client.end();
    process.exit(1);
  }

  await client.end();
}

runTest().catch(err => {
  console.error('Preservation test failed:', err);
  process.exit(1);
});
