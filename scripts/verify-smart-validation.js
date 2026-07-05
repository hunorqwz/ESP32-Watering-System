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
  console.log('--- STARTING SMART PIN VALIDATION & FORCE CONFIRM TESTS ---');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  // Test 1: Hard block two moisture sensors on the same pin (Pin 32)
  console.log('\nTest 1: Trying to add a new Moisture sensor on Pin 32 (already taken by Zone 1)...');
  const res1 = await fetch(`${baseUrl}/api/sensor`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.API_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      name: 'Conflict Moisture',
      type: 'moisture',
      pin: 32
    })
  });
  const body1 = await res1.json();
  console.log('API Status Code:', res1.status);
  console.log('API Response:', body1);

  if (res1.status === 400 && body1.success === false && body1.error.includes('Conflict')) {
    console.log('Result: SUCCESS (Hard conflict correctly blocked)');
  } else {
    console.error('Result: FAILURE (Expected 400 Bad Request block)');
    await client.end();
    process.exit(1);
  }

  // Test 2: Temp and Humidity sensors sharing a pin should trigger a soft warning
  console.log('\nTest 2: Adding a new Humidity sensor on Pin 4 (taken by Temp, should prompt for confirmation)...');
  const res2 = await fetch(`${baseUrl}/api/sensor`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.API_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      name: 'Shared Humidity',
      type: 'humidity',
      pin: 4
    })
  });
  const body2 = await res2.json();
  console.log('API Status Code:', res2.status);
  console.log('API Response:', body2);

  if (body2.needsForce === true && body2.warning.includes('Warning')) {
    console.log('Result: SUCCESS (Soft warning returned correctly)');
  } else {
    console.error('Result: FAILURE (Expected needsForce: true)');
    await client.end();
    process.exit(1);
  }

  // Test 3: Re-sending with force: true should bypass the soft warning and write to DB
  console.log('\nTest 3: Re-sending with force: true...');
  const res3 = await fetch(`${baseUrl}/api/sensor`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.API_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      name: 'Shared Humidity',
      type: 'humidity',
      pin: 4,
      force: true
    })
  });
  const body3 = await res3.json();
  console.log('API Status Code:', res3.status);
  console.log('API Response:', body3);

  if (res3.status === 200 && body3.success === true) {
    console.log('Result: SUCCESS (Force saved successfully)');
  } else {
    console.error('Result: FAILURE (Expected 200 OK success)');
    await client.end();
    process.exit(1);
  }

  // Cleanup: Delete the sensor we just added
  console.log('\nCleaning up test sensor...');
  await client.query("DELETE FROM sensor_configs WHERE name = 'Shared Humidity'");

  await client.end();
  console.log('\n--- ALL SMART PIN VALIDATION TESTS COMPLETED SUCCESSFULLY ---');
}

runTest().catch(err => {
  console.error('Validation test failed:', err);
  process.exit(1);
});
