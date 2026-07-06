import { Client } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

// Load env vars
const env = fs.readFileSync('.env', 'utf8');
const config = {};
env.split('\n').forEach(l => {
  const parts = l.split('=');
  if (parts.length >= 2) {
    config[parts[0].trim()] = parts.slice(1).join('=').trim();
  }
});

const connectionString = config.DATABASE_URL;
const token = config.API_ACCESS_TOKEN;
const baseUrl = 'http://127.0.0.1:3000';

async function testEdgeCases() {
  console.log('=== STARTING APPLICATION STRESS & EDGE CASE TESTS ===');
  
  const client = new Client({ connectionString });
  await client.connect();

  try {
    // ----------------------------------------------------
    // Test 1: Relational Integrity Array Triggers (DB Level)
    // ----------------------------------------------------
    console.log('\n[Edge Case 1] Inserting schedule with non-existent Flow ID...');
    try {
      await client.query(
        `INSERT INTO watering_schedules (flow_ids, time_of_day, duration_seconds, days_of_week)
         VALUES (ARRAY[99999], '12:00:00', 60, ARRAY[1])`
      );
      console.error('FAIL: Expected trigger error, but insertion succeeded.');
      process.exit(1);
    } catch (err) {
      console.log('Result: SUCCESS (Trigger blocked invalid Flow ID reference):', err.message);
    }

    console.log('\n[Edge Case 2] Inserting schedule with non-existent Pump ID...');
    try {
      await client.query(
        `INSERT INTO watering_schedules (pump_ids, time_of_day, duration_seconds, days_of_week)
         VALUES (ARRAY[99999], '12:00:00', 60, ARRAY[1])`
      );
      console.error('FAIL: Expected trigger error, but insertion succeeded.');
      process.exit(1);
    } catch (err) {
      console.log('Result: SUCCESS (Trigger blocked invalid Pump ID reference):', err.message);
    }

    console.log('\n[Edge Case 3] Inserting watering flow with non-existent Sensor ID...');
    try {
      await client.query(
        `INSERT INTO watering_flows (name, pump_id, sensor_ids)
         VALUES ('Invalid Flow', 1, ARRAY[99999])`
      );
      console.error('FAIL: Expected trigger error, but insertion succeeded.');
      process.exit(1);
    } catch (err) {
      console.log('Result: SUCCESS (Trigger blocked invalid Sensor ID reference):', err.message);
    }

    // ----------------------------------------------------
    // Test 2: Ingestion Malformed Payload Tests
    // ----------------------------------------------------
    console.log('\n[Edge Case 4] Ingesting telemetry with empty body...');
    const ingestEmpty = await fetch(`${baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    console.log('Status Code:', ingestEmpty.status);
    if (ingestEmpty.status === 400) {
      console.log('Result: SUCCESS (Bad request returned correctly)');
    } else {
      console.error('FAIL: Expected status 400');
      process.exit(1);
    }

    console.log('\n[Edge Case 5] Ingesting telemetry with non-existent sensor ID...');
    const ingestBadSensor = await fetch(`${baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        deviceId: 'esp32_test_local',
        readings: [{ sensorId: 99999, value: 50 }]
      })
    });
    console.log('Status Code:', ingestBadSensor.status);
    if (ingestBadSensor.status === 201) {
      // Unmapped sensor IDs are ignored or written. In our route, it checks against valid config IDs.
      const dbCheck = await client.query('SELECT * FROM sensor_readings WHERE sensor_config_id = 99999');
      if (dbCheck.rows.length === 0) {
        console.log('Result: SUCCESS (Telemetry accepted, but invalid sensor reading was ignored)');
      } else {
        console.error('FAIL: Invalid sensor reading inserted in DB');
        process.exit(1);
      }
    } else {
      console.error('FAIL: Expected status 201');
      process.exit(1);
    }

    // ----------------------------------------------------
    // Test 3: Command validation edge cases
    // ----------------------------------------------------
    console.log('\n[Edge Case 6] Triggering pump with boolean state instead of integer...');
    const cmdBool = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ pump: 1, state: true })
    });
    console.log('Status Code:', cmdBool.status);
    if (cmdBool.status === 400) {
      console.log('Result: SUCCESS (Blocked invalid boolean parameter type)');
    } else {
      console.error('FAIL: Expected status 400');
      process.exit(1);
    }

    console.log('\n[Edge Case 7] Triggering pump with invalid negative pump ID...');
    const cmdNeg = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ pump: -5, state: 1 })
    });
    console.log('Status Code:', cmdNeg.status);
    if (cmdNeg.status === 400) {
      console.log('Result: SUCCESS (Blocked invalid pump index)');
    } else {
      console.error('FAIL: Expected status 400');
      process.exit(1);
    }

    // ----------------------------------------------------
    // Test 4: Concurrency and Load Ingestion Stress Test
    // ----------------------------------------------------
    console.log('\n[Stress Test 8] Sending 50 concurrent telemetry ingestion requests...');
    const startTime = Date.now();
    const requests = Array.from({ length: 50 }).map((_, i) => {
      return fetch(`${baseUrl}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          deviceId: 'esp32_stress_client',
          readings: [
            { sensorId: 1, value: 1500 + (i * 10) },
            { sensorId: 8, value: 50 } // reservoir
          ]
        })
      });
    });

    const responses = await Promise.all(requests);
    const successCount = responses.filter(r => r.status === 201).length;
    const duration = Date.now() - startTime;
    
    console.log(`Successfully completed ${successCount}/50 requests in ${duration}ms.`);
    if (successCount === 50) {
      console.log('Result: SUCCESS (All stress telemetry packets processed successfully)');
    } else {
      console.error(`FAIL: Only ${successCount} requests succeeded`);
      process.exit(1);
    }

    // Clean up stress test database entries
    console.log('\n[Cleanup] Cleaning up stress test database entries...');
    await client.query("DELETE FROM sensor_readings WHERE created_at > NOW() - INTERVAL '1 minute'");
    console.log('Cleanup completed successfully.');
    
    console.log('\n=== ALL STRESS AND EDGE CASE TESTS PASSED SUCCESSFULLY ===');

  } catch (err) {
    console.error('Test run error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

testEdgeCases();
