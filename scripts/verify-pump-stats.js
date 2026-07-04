import fs from 'fs';
import path from 'path';
import { Client } from '@neondatabase/serverless';

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

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const databaseUrl = process.env.DATABASE_URL;

async function runTest() {
  console.log('--- STARTING PUMP STATS (DURATION & CONSUMPTION) INTEGRATION TESTS ---');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  // 1. Query and cache original flow rate, then set Pump 1 flow rate to 5.0 L/min for testing
  const origRes = await client.query('SELECT flow_rate_lpm FROM pump_configs WHERE id = 1');
  const originalFlowRate = origRes.rows[0]?.flow_rate_lpm !== null && origRes.rows[0]?.flow_rate_lpm !== undefined ? parseFloat(origRes.rows[0].flow_rate_lpm) : 4.0;
  console.log(`Original Pump 1 flow rate is ${originalFlowRate} L/min.`);
  console.log('Setting Pump 1 flow rate to 5.0 L/min...');
  await client.query('UPDATE pump_configs SET flow_rate_lpm = 5.0 WHERE id = 1');

  // 2. Insert a simulated ON event 15 seconds ago
  console.log('Simulating ON event for Pump 1 15 seconds ago...');
  const simulatedOnTime = new Date(Date.now() - 15000);
  await client.query(
    `INSERT INTO command_logs (pump, pump_name, pump_pin, state, status, response_msg_id, created_at) 
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [1, 'Pump 1', 25, 1, 'success', 'test_on_msg_id', simulatedOnTime]
  );

  // 3. Send OFF command via API endpoint
  console.log('Sending OFF command to /api/command...');
  const res = await fetch(`${baseUrl}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pump: 1, state: 0 })
  });
  const body = await res.json();
  console.log('API Status Code:', res.status);
  console.log('API Response:', body);

  if (res.status !== 200 || !body.success) {
    console.error('Result: FAILURE (API request failed)');
    // Restore flow rate on failure
    await client.query('UPDATE pump_configs SET flow_rate_lpm = $1 WHERE id = 1', [originalFlowRate]);
    await client.end();
    process.exit(1);
  }

  // 4. Query DB for the OFF log row we just inserted
  console.log('Querying database for the logged OFF command...');
  const dbRes = await client.query(
    'SELECT duration_seconds, water_used_liters FROM command_logs WHERE pump = 1 AND state = 0 ORDER BY created_at DESC LIMIT 1'
  );
  
  const log = dbRes.rows[0];
  console.log('Logged Duration:', log.duration_seconds, 'seconds');
  console.log('Logged Water Used:', log.water_used_liters, 'Liters');

  let testPassed = true;

  // Assertions: duration should be around 15 seconds, and water used should be around 15 / 60 * 5.0 = 1.25 -> 1.3 Liters
  if (log.duration_seconds >= 14 && log.duration_seconds <= 17) {
    console.log('Result: SUCCESS (Duration is accurate)');
  } else {
    console.error('Result: FAILURE (Duration is outside expected range of 14-17s)');
    testPassed = false;
  }

  if (parseFloat(log.water_used_liters) === 1.3 || parseFloat(log.water_used_liters) === 1.2) {
    console.log('Result: SUCCESS (Water usage estimation is accurate)');
  } else {
    console.error('Result: FAILURE (Water usage calculation is incorrect)');
    testPassed = false;
  }

  // Cleanup: Restore flow rate and delete test log entries
  console.log('\nCleaning up database modifications...');
  try {
    await client.query('UPDATE pump_configs SET flow_rate_lpm = $1 WHERE id = 1', [originalFlowRate]);
    await client.query(
      `DELETE FROM command_logs 
       WHERE pump = 1 AND response_msg_id = 'test_on_msg_id'`
    );
    await client.query(
      `DELETE FROM command_logs 
       WHERE pump = 1 AND state = 0 AND created_at > NOW() - INTERVAL '2 minutes'`
    );
    console.log('Cleanup completed successfully.');
  } catch (cleanupErr) {
    console.warn('Cleanup failed:', cleanupErr.message);
  }

  await client.end();
  
  if (!testPassed) {
    console.error('\n--- PUMP STATS TESTS FAILED ---');
    process.exit(1);
  }
  
  console.log('\n--- ALL PUMP STATS TESTS COMPLETED SUCCESSFULLY ---');
}

runTest().catch(err => {
  console.error('Pump stats verification failed:', err);
  process.exit(1);
});
