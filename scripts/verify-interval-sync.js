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
  console.log('--- STARTING INTERVAL SYNC INTEGRATION TESTS ---');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  // Query original configuration value to restore later
  const origRes = await client.query(
    "SELECT value FROM system_config WHERE key = 'telemetry_interval_minutes'"
  );
  const originalInterval = origRes.rows[0]?.value || '15';
  console.log(`Original telemetry interval: ${originalInterval} minutes.`);

  // 1. Submit interval update of 180 minutes (3 hours)
  console.log('Sending config update: telemetry_interval_minutes = 180...');
  const res = await fetch(`${baseUrl}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'telemetry_interval_minutes', value: '180' })
  });
  const body = await res.json();
  console.log('API Response:', body);

  if (res.status !== 200 || !body.success) {
    console.error('Result: FAILURE (API call failed)');
    // Restore on early failure
    await client.query("UPDATE system_config SET value = $1 WHERE key = 'telemetry_interval_minutes'", [originalInterval]);
    await client.end();
    process.exit(1);
  }

  // 2. Fetch dashboard configs to confirm value
  console.log('Querying dashboard dataset endpoint...');
  const dashRes = await fetch(`${baseUrl}/api/dashboard`);
  const dashBody = await dashRes.json();
  
  const savedMins = dashBody.configs ? parseInt(dashBody.configs['telemetry_interval_minutes'], 10) : null;
  console.log('Returned telemetry_interval_minutes from dashboard payload:', savedMins);

  let testPassed = true;
  if (savedMins === 180) {
    console.log('Result: SUCCESS (telemetry_interval_minutes is synced and verified)');
  } else {
    console.error(`Result: FAILURE (Expected 180 minutes, got ${savedMins})`);
    testPassed = false;
  }

  // Cleanup: Restore original configuration value
  console.log('\nRestoring original telemetry interval configuration...');
  try {
    await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'telemetry_interval_minutes', value: originalInterval })
    });
    console.log('Telemetry interval configuration successfully restored.');
  } catch (restoreErr) {
    console.warn('Failed to restore telemetry interval configuration:', restoreErr.message);
  }

  await client.end();
  
  if (!testPassed) {
    console.error('\n--- INTERVAL SYNC TESTS FAILED ---');
    process.exit(1);
  }
  
  console.log('\n--- ALL INTERVAL SYNC TESTS COMPLETED SUCCESSFULLY ---');
}

runTest().catch(err => {
  console.error('Interval sync verification failed:', err);
  process.exit(1);
});
