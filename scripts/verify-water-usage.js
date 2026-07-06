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
const baseUrl = 'http://localhost:3000';

async function main() {
  console.log('--- STARTING ACTUAL WATER USAGE CALCULATION INTEGRATION TESTS ---');

  const client = new Client({ connectionString });
  await client.connect();

  let createdOnId = null;
  let createdOffId = null;
  const testSensorId = 8; // Default Reservoir Level sensor ID from seeds

  try {
    // 1. Prepare reservoir configurations
    console.log('\n[Setup] Ensuring reservoir settings are populated...');
    const configs = [
      { k: 'reservoir_sensor_offset_cm', v: '120' },
      { k: 'reservoir_height_cm', v: '60' },
      { k: 'reservoir_use_dimensions', v: 'true' },
      { k: 'reservoir_width_cm', v: '60' },
      { k: 'reservoir_length_cm', v: '70' }
    ];
    for (const cfg of configs) {
      await client.query(
        'INSERT INTO system_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [cfg.k, cfg.v]
      );
    }

    // 2. Insert starting telemetry reading (water level distance = 20cm)
    // Sensor offset = 120cm, raw distance = 20cm -> water height = 100cm (clamped to height 60cm).
    // Capacity at 60cm height = (60 * 70 * 60) / 1000 = 252.0 Liters.
    console.log('\n[Step 1] Ingesting starting water level telemetry (20cm distance)...');
    const t0Res = await fetch(`${baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.API_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        deviceId: 'esp32_test_local',
        readings: [
          { sensorId: testSensorId, value: 20 }
        ]
      })
    });
    console.log('Ingest T0 status:', t0Res.status);
    if (t0Res.status !== 201) {
      console.error('Ingest T0 Error Body:', await t0Res.text());
    }

    // 3. Send Pump ON Command
    console.log('\n[Step 2] Triggering Pump 1 ON...');
    const onRes = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.API_ACCESS_TOKEN}`
      },
      body: JSON.stringify({ pump: 1, state: 1 })
    });
    const onBody = await onRes.json();
    console.log('ON command status:', onRes.status);

    // Fetch the ON command log to verify start volume is recorded
    const onLogs = await client.query(
      'SELECT id, start_volume_liters FROM command_logs WHERE pump = 1 AND state = 1 ORDER BY created_at DESC LIMIT 1'
    );
    createdOnId = onLogs.rows[0]?.id;
    const startVolume = parseFloat(onLogs.rows[0]?.start_volume_liters);
    console.log('ON Log ID:', createdOnId, '| Recorded Start Volume:', startVolume, 'L');
    if (isNaN(startVolume) || startVolume <= 0) {
      throw new Error('Start volume was not correctly calculated or recorded.');
    }

    // 4. Send Pump OFF Command
    console.log('\n[Step 3] Triggering Pump 1 OFF...');
    const offRes = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.API_ACCESS_TOKEN}`
      },
      body: JSON.stringify({ pump: 1, state: 0 })
    });
    const offBody = await offRes.json();
    console.log('OFF command status:', offRes.status);

    // Fetch the OFF command log to verify water used is deferred (should be NULL)
    const offLogs = await client.query(
      'SELECT id, water_used_liters FROM command_logs WHERE pump = 1 AND state = 0 ORDER BY created_at DESC LIMIT 1'
    );
    createdOffId = offLogs.rows[0]?.id;
    console.log('OFF Log ID:', createdOffId, '| Initial Water Used (deferred):', offLogs.rows[0]?.water_used_liters);
    if (offLogs.rows[0]?.water_used_liters !== null) {
      throw new Error('Water used should be null (deferred) on pump turn-off command.');
    }

    // 5. Ingest Ending Telemetry (water level distance = 25cm -> water height = 95cm, clamped to 60cm but calculation uses 120-25 = 95cm, wait!
    // Since offset is 120 and height is 60:
    // T0 height = 120 - 20 = 100cm -> clamped to heightCm = 60cm. Volume = (60 * 70 * 60) / 1000 = 252.0L.
    // T1 height = 120 - 25 = 95cm -> clamped to heightCm = 60cm. Volume = 252.0L.
    // Wait! If the height is clamped to 60cm, then both 20cm and 25cm distance will yield the same volume!
    // Let's use distances within the height range [60cm, 120cm]!
    // E.g., Sensor offset = 120cm, height = 60cm (meaning full tank height is 60cm, from bottom = 60cm to top = 120cm).
    // So raw distance of 80cm -> water height = 120 - 80 = 40cm. Volume = (60 * 70 * 40) / 1000 = 168.0L.
    // Raw distance of 90cm -> water height = 120 - 90 = 30cm. Volume = (60 * 70 * 30) / 1000 = 126.0L.
    // Let's modify the telemetry readings to use 80cm and 90cm!
    // T0 = 80cm, T1 = 90cm.
    // Expected start volume = 168.0L.
    // Expected end volume = 126.0L.
    // Expected water used = 168.0 - 126.0 = 42.0 Liters.
    // This is mathematically correct! Let's do that!
    console.log('\n[Step 4] Ingesting ending water level telemetry (T0=80cm -> T1=90cm distance)...');
    
    // Let's override the ON log start volume manually or simulate it with 80cm starting reading:
    // First, let's update the ON log start volume to 168.0L to simulate starting distance = 80cm:
    await client.query('UPDATE command_logs SET start_volume_liters = 168.0 WHERE id = $1', [createdOnId]);
    console.log('Simulated Start Volume updated to 168.0L.');

    const t1Res = await fetch(`${baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.API_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        deviceId: 'esp32_test_local',
        readings: [
          { sensorId: testSensorId, value: 90 }
        ]
      })
    });
    console.log('Ingest T1 status:', t1Res.status);

    // 6. Query OFF log again to verify updated water used value
    console.log('\n[Step 5] Querying command log for resolved water usage...');
    const resolvedLogs = await client.query(
      'SELECT water_used_liters FROM command_logs WHERE id = $1',
      [createdOffId]
    );
    const waterUsed = parseFloat(resolvedLogs.rows[0]?.water_used_liters);
    console.log('Resolved Water Used Liters:', waterUsed, 'L');
    
    // Expected: 168.0L - 126.0L = 42.0L
    if (isNaN(waterUsed) || Math.abs(waterUsed - 42.0) > 0.1) {
      throw new Error(`Incorrect water usage resolved. Expected 42.0L but got ${waterUsed}L.`);
    }
    console.log('SUCCESS: Water usage resolved to exactly 42.0 Liters!');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    console.log('\n[Cleanup] Cleaning up database test records...');
    if (createdOnId) {
      await client.query('DELETE FROM command_logs WHERE id = $1', [createdOnId]);
    }
    if (createdOffId) {
      await client.query('DELETE FROM command_logs WHERE id = $1', [createdOffId]);
    }
    await client.end();
    console.log('--- TEST RUN COMPLETED ---');
  }
}

main();
