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
  console.log('--- STARTING RESERVOIR CALIBRATION AUTO-SYNC INTEGRATION TESTS ---');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  // Query original configuration values to restore them later
  const origRes = await client.query(
    "SELECT key, value FROM system_config WHERE key IN ('reservoir_height_cm', 'reservoir_sensor_offset_cm')"
  );
  const origConfigs = {};
  origRes.rows.forEach(r => {
    origConfigs[r.key] = r.value;
  });
  const origHeight = origConfigs['reservoir_height_cm'] || '50';
  const origOffset = origConfigs['reservoir_sensor_offset_cm'] || '100';
  console.log(`Original reservoir configs - Height: ${origHeight} cm, Offset: ${origOffset} cm.`);

  // 1. Submit reservoir_height_cm change to /api/config
  console.log('Sending config update: reservoir_height_cm = 60...');
  const res1 = await fetch(`${baseUrl}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'reservoir_height_cm', value: '60' })
  });
  const body1 = await res1.json();
  console.log('API Response 1:', body1);

  // 2. Submit reservoir_sensor_offset_cm change to /api/config
  console.log('Sending config update: reservoir_sensor_offset_cm = 120...');
  const res2 = await fetch(`${baseUrl}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'reservoir_sensor_offset_cm', value: '120' })
  });
  const body2 = await res2.json();
  console.log('API Response 2:', body2);

  if (res1.status !== 200 || res2.status !== 200 || !body1.success || !body2.success) {
    console.error('Result: FAILURE (API calls failed)');
    // Restore original configs on early failure
    await client.query("UPDATE system_config SET value = $1 WHERE key = 'reservoir_height_cm'", [origHeight]);
    await client.query("UPDATE system_config SET value = $2 WHERE key = 'reservoir_sensor_offset_cm'", [origOffset]);
    await client.end();
    process.exit(1);
  }

  // 3. Query DB for water_level sensor configuration
  console.log('Querying database for water_level sensor limits...');
  const dbRes = await client.query(
    "SELECT dry_limit, wet_limit FROM sensor_configs WHERE type = 'water_level'"
  );

  if (dbRes.rows.length === 0) {
    console.error('Result: FAILURE (No water_level sensor found in DB)');
    await client.end();
    process.exit(1);
  }

  const sensor = dbRes.rows[0];
  console.log('Logged dry_limit (Sensor Mounting Height):', sensor.dry_limit);
  console.log('Logged wet_limit (Sensor Full Distance):', sensor.wet_limit);

  let testPassed = true;

  // Assertions: dry_limit should be 120, wet_limit should be 120 - 60 = 60
  if (parseInt(sensor.dry_limit, 10) === 120) {
    console.log('Result: SUCCESS (dry_limit is synced to mounting height offset)');
  } else {
    console.error(`Result: FAILURE (dry_limit is ${sensor.dry_limit}, expected 120)`);
    testPassed = false;
  }

  if (parseInt(sensor.wet_limit, 10) === 60) {
    console.log('Result: SUCCESS (wet_limit is synced to offset - height)');
  } else {
    console.error(`Result: FAILURE (wet_limit is ${sensor.wet_limit}, expected 60)`);
    testPassed = false;
  }

  // Cleanup: Restore original configurations by calling the configuration API or updating directly
  console.log('\nRestoring original reservoir configurations...');
  try {
    await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'reservoir_height_cm', value: origHeight })
    });
    await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'reservoir_sensor_offset_cm', value: origOffset })
    });
    console.log('Original reservoir configurations successfully restored.');
  } catch (restoreErr) {
    console.warn('Failed to restore reservoir configurations:', restoreErr.message);
  }

  await client.end();
  
  if (!testPassed) {
    console.error('\n--- RESERVOIR CALIBRATION TESTS FAILED ---');
    process.exit(1);
  }
  
  console.log('\n--- ALL RESERVOIR CALIBRATION TESTS COMPLETED SUCCESSFULLY ---');
}

runTest().catch(err => {
  console.error('Reservoir calibration verification failed:', err);
  process.exit(1);
});
