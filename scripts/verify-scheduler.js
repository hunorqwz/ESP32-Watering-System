import fs from 'fs';
import path from 'path';
import { Client } from '@neondatabase/serverless';

// Load .env file manually
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

async function runTests() {
  console.log('--- STARTING WATERING SCHEDULER & WEATHER SKIP INTEGRATION TESTS ---');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  let createdScheduleId = null;
  const testDate = new Date();
  testDate.setDate(testDate.getDate() + 1); // tomorrow
  const testDateStr = testDate.toISOString().split('T')[0];

  // Map tomorrow's day of week to scheduling days (1 = Mon, 7 = Sun)
  const jsDay = testDate.getDay();
  const testDayOfWeek = jsDay === 0 ? 7 : jsDay;

  try {
    // 1. Create a dynamic test schedule for tomorrow at 08:00 AM
    console.log('\n[Test 1] Creating a test schedule for tomorrow at 08:00...');
    const resCreate = await fetch(`${baseUrl}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pump_ids: [1],
        time_of_day: '08:00',
        duration_seconds: 90,
        days_of_week: [testDayOfWeek],
        enabled: true
      })
    });
    const bodyCreate = await resCreate.json();
    console.log('Status Code:', resCreate.status);
    console.log('Response:', bodyCreate);

    if (resCreate.status !== 200 || !bodyCreate.success) {
      throw new Error('Failed to create schedule');
    }

    // Retrieve schedule ID from database
    const dbSched = await client.query(
      "SELECT id FROM watering_schedules WHERE 1 = ANY(pump_ids) AND time_of_day = '08:00:00'"
    );
    createdScheduleId = dbSched.rows[0]?.id;
    console.log('Created test schedule ID:', createdScheduleId);

    // 2. Inject clear weather forecast for tomorrow (to test normal scheduling)
    console.log('\n[Test 2] Injecting dry weather forecast for tomorrow...');
    const resClearWeather = await fetch(`${baseUrl}/api/weather`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        forecast: [
          {
            date: testDateStr,
            probability: 0.10,
            precipitation_mm: 0.0,
            temp_c: 25.0,
            description: 'Clear and Sunny'
          }
        ]
      })
    });
    const bodyClearWeather = await resClearWeather.json();
    console.log('Weather Inject Status:', resClearWeather.status, bodyClearWeather.success ? 'Success' : 'Failed');

    // Query dashboard and check prediction
    console.log('Querying dashboard dataset for Next Run prediction (expected to run)...');
    const resDash1 = await fetch(`${baseUrl}/api/dashboard`);
    const dashBody1 = await resDash1.json();
    const nextWatering1 = dashBody1.next_watering;
    
    console.log('Next run predicted time:', nextWatering1.time);
    console.log('Next run skipped state:', nextWatering1.skipped);
    console.log('Next run reason:', nextWatering1.reason);

    if (nextWatering1.skipped === false && nextWatering1.pump_id === 1) {
      console.log('Result: SUCCESS (Schedule predicted to run normally)');
    } else {
      throw new Error('Expected schedule to be active and not skipped');
    }

    // 3. Inject heavy rain forecast for tomorrow (to test proactive rain skip)
    console.log('\n[Test 3] Injecting heavy rain weather forecast for tomorrow...');
    const resRainWeather = await fetch(`${baseUrl}/api/weather`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        forecast: [
          {
            date: testDateStr,
            probability: 0.85,
            precipitation_mm: 6.5,
            temp_c: 16.0,
            description: 'Heavy rain showers'
          }
        ]
      })
    });
    const bodyRainWeather = await resRainWeather.json();
    console.log('Weather Inject Status:', resRainWeather.status, bodyRainWeather.success ? 'Success' : 'Failed');

    // Query dashboard and check prediction for rain skip
    console.log('Querying dashboard dataset for Next Run prediction (expected rain skip)...');
    const resDash2 = await fetch(`${baseUrl}/api/dashboard`);
    const dashBody2 = await resDash2.json();
    const nextWatering2 = dashBody2.next_watering;

    console.log('Next run predicted time:', nextWatering2.time);
    console.log('Next run skipped state:', nextWatering2.skipped);
    console.log('Next run reason:', nextWatering2.reason);

    if (nextWatering2.skipped === true && nextWatering2.reason.includes('Skip active')) {
      console.log('Result: SUCCESS (Schedule predicted to skip due to heavy rain forecast)');
    } else {
      throw new Error('Expected schedule to be flagged as skipped');
    }

  } finally {
    // Cleanup: Restore database to clean state
    console.log('\nCleaning up database modifications...');
    if (createdScheduleId) {
      console.log(`Deleting test schedule ID: ${createdScheduleId}...`);
      await client.query('DELETE FROM watering_schedules WHERE id = $1', [createdScheduleId]);
    }
    
    console.log(`Clearing injected weather cache entry for: ${testDateStr}...`);
    await client.query('DELETE FROM weather_forecast_cache WHERE forecast_date = $1::date', [testDateStr]);
    
    await client.end();
    console.log('Cleanup completed successfully.');
  }

  console.log('\n--- ALL WATERING SCHEDULER & WEATHER TESTS COMPLETED SUCCESSFULLY ---');
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
