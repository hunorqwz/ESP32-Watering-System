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

  // 0. Query if Pump 3 and Pump 4 exist before deleting
  const existingPumpsRes = await client.query('SELECT name FROM pump_configs WHERE name IN ($1, $2)', ['Pump 3', 'Pump 4']);
  const hadPump3 = existingPumpsRes.rows.some(r => r.name === 'Pump 3');
  const hadPump4 = existingPumpsRes.rows.some(r => r.name === 'Pump 4');

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
  let testPassed = true;
  if (!containsPump3 && !containsPump4) {
    console.log('\nResult: SUCCESS (Custom deletions were preserved!)');
  } else {
    console.error('\nResult: FAILURE (Pumps were restored by db-init.js!)');
    testPassed = false;
  }

  // Cleanup: Re-insert Pump 3 and Pump 4 only if they existed at the start
  console.log('\nCleaning up database deletions...');
  try {
    const pumpsToRestore = [];
    if (hadPump3) pumpsToRestore.push("(3, 'Pump 3', 18, 0, 4.0)");
    if (hadPump4) pumpsToRestore.push("(4, 'Pump 4', 19, 0, 4.0)");
    
    if (pumpsToRestore.length > 0) {
      console.log(`Re-inserting pumps: ${pumpsToRestore.join(', ')}`);
      await client.query(
        `INSERT INTO pump_configs (id, name, pin, state, flow_rate_lpm)
         VALUES ${pumpsToRestore.join(', ')}
         ON CONFLICT (id) DO UPDATE 
         SET name = EXCLUDED.name, pin = EXCLUDED.pin, state = EXCLUDED.state, flow_rate_lpm = EXCLUDED.flow_rate_lpm`
      );
      // Sync sequence value to prevent duplicate key constraint violations on next insert
      await client.query("SELECT setval(pg_get_serial_sequence('pump_configs', 'id'), COALESCE(max(id), 1)) FROM pump_configs");
      console.log('Pumps successfully restored.');
    } else {
      console.log('No pumps needed restoration.');
    }
  } catch (restoreErr) {
    console.warn('Failed to restore deleted pumps:', restoreErr.message);
  }

  await client.end();
  
  if (!testPassed) {
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error('Preservation test failed:', err);
  process.exit(1);
});
