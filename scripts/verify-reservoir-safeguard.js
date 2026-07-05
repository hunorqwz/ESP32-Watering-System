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
const baseUrl = 'http://127.0.0.1:3000';

async function main() {
  console.log('--- STARTING RESERVOIR SAFEGUARD INTEGRATION TESTS ---');

  const client = new Client({ connectionString });
  await client.connect();

  let createdScheduleId = null;
  let createdReadingId = null;
  let originalThreshold = null;

  try {
    // 1. Get current safety threshold to restore later
    const thRes = await client.query("SELECT value FROM system_config WHERE key = 'reservoir_min_volume_liters'");
    originalThreshold = thRes.rows[0]?.value || '5.0';
    console.log(`[Config] Original safety minimum limit: ${originalThreshold} Liters`);

    // Set threshold to 15.0 Liters for the test
    await client.query("UPDATE system_config SET value = '15.0' WHERE key = 'reservoir_min_volume_liters'");

    // 2. Insert mock low reservoir water level reading (118cm sensor distance = ~1.2L or ~8.4L depending on settings, which is < 15.0L)
    console.log('\n[Step 1] Inserting mock low water level reading for reservoir (118cm distance)...');
    const readingRes = await client.query(
      `INSERT INTO sensor_readings (sensor_config_id, value)
       VALUES (8, 118) RETURNING id`
    );
    createdReadingId = readingRes.rows[0].id;
    console.log(`Created mock reading ID: ${createdReadingId}`);

    // Ensure pump 1 state is initially 0
    await client.query('UPDATE pump_configs SET state = 0 WHERE id = 1');

    // 3. Test Manual Command Lockout
    console.log('\n[Step 2] Testing manual pump ON trigger (should be blocked)...');
    const cmdRes = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pump: 1, state: 1 })
    });
    const cmdBody = await cmdRes.json();
    console.log('Manual command response (Status:', cmdRes.status, '):', cmdBody);

    if (cmdRes.status !== 400 || cmdBody.success) {
      throw new Error('Manual pump trigger was not blocked by safety limit.');
    }
    if (!cmdBody.error.includes('Locked: Reservoir volume')) {
      throw new Error(`Unexpected error message returned: '${cmdBody.error}'`);
    }
    console.log('SUCCESS: Manual pump command was successfully blocked by low reservoir safeguard!');

    // 4. Test Scheduled Watering Skip Lockout
    // Set up a test schedule for Tuesday (Day 2) at 08:00
    const timeOfDay = '08:00:00';
    const localDayOfWeek = 2;
    console.log('\n[Step 3] Creating temporary schedule for Tuesday at 08:00...');
    const schedRes = await client.query(
      `INSERT INTO watering_schedules (pump_ids, time_of_day, duration_seconds, days_of_week, enabled)
       VALUES (ARRAY[1], $1, 60, ARRAY[$2::int], true) RETURNING id`,
      [timeOfDay, localDayOfWeek]
    );
    createdScheduleId = schedRes.rows[0].id;
    console.log(`Created test schedule ID: ${createdScheduleId}`);

    // Execute cron runner
    console.log('\n[Step 4] Executing cron runner GET /api/cron/run?simulated_time=08:00&simulated_day=2...');
    const cronRes = await fetch(`${baseUrl}/api/cron/run?simulated_time=08:00&simulated_day=2`);
    const cronBody = await cronRes.json();
    console.log('Cron response:', cronBody);

    if (cronRes.status !== 200 || !cronBody.success) {
      throw new Error('Cron execution failed.');
    }

    const trigger = cronBody.triggers.find(t => t.pumpId === 1);
    if (!trigger) {
      throw new Error('Pump 1 was not evaluated in triggers list.');
    }
    if (trigger.status !== 'skipped' || !trigger.reason.includes('Low Reservoir Volume')) {
      throw new Error(`Expected skipped due to Low Reservoir but got status '${trigger.status}', reason: '${trigger.reason}'`);
    }
    console.log('SUCCESS: Scheduled cycle was successfully skipped due to low reservoir safeguard!');

    // Check command_logs table to verify skipped log is recorded in database
    const logRes = await client.query(
      `SELECT error_details FROM command_logs 
       WHERE pump = 1 AND state = 1 AND status = 'skipped' 
       ORDER BY created_at DESC LIMIT 1`
    );
    console.log('Last command log skipped message:', logRes.rows[0]?.error_details);
    if (!logRes.rows[0]?.error_details.includes('Safety Lockout: Reservoir is too low')) {
      throw new Error('No corresponding skipped log record found in command_logs.');
    }
    console.log('SUCCESS: Skip log was successfully persisted to command_logs database table!');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    console.log('\n[Cleanup] Cleaning up database test records...');
    if (createdScheduleId) {
      await client.query('DELETE FROM watering_schedules WHERE id = $1', [createdScheduleId]);
    }
    if (createdReadingId) {
      await client.query('DELETE FROM sensor_readings WHERE id = $1', [createdReadingId]);
    }
    if (originalThreshold !== null) {
      await client.query('UPDATE system_config SET value = $1 WHERE key = $2', [originalThreshold, 'reservoir_min_volume_liters']);
    }
    // Delete test command log records generated by this run
    await client.query("DELETE FROM command_logs WHERE pump = 1 AND created_at > NOW() - INTERVAL '15 minutes'");
    await client.end();
    console.log('--- TEST RUN COMPLETED ---');
  }
}

main();
