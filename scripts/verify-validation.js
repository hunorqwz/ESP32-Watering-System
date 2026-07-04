import fs from 'fs';
import path from 'path';

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

async function runTests() {
  console.log('--- STARTING GPIO PIN CONFLICT VALIDATION TESTS ---');

  // Test 1: Try to create a sensor on pin 25 (occupied by Pump 1)
  console.log('\n[Test 1] Creating sensor on occupied Pump 1 pin (GPIO 25)...');
  try {
    const res = await fetch(`${baseUrl}/api/sensor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Conflict Test Sensor',
        type: 'moisture',
        pin: 25,
        sensor_group: 'Testing'
      })
    });
    const body = await res.json();
    console.log('Status Code:', res.status);
    console.log('Response:', body);
    if (res.status === 400 && body.error.includes('pump "Pump 1"')) {
      console.log('Result: SUCCESS (Blocked correctly with descriptive message)');
    } else {
      console.error('Result: FAILURE (Expected 400 conflict error)');
      process.exit(1);
    }
  } catch (err) {
    console.error('Error during Test 1:', err.message);
    process.exit(1);
  }

  // Test 2: Try to create a pump on pin 32 (occupied by Zone 1 sensor)
  console.log('\n[Test 2] Creating pump on occupied Zone 1 pin (GPIO 32)...');
  try {
    const res = await fetch(`${baseUrl}/api/pump`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Conflict Test Pump',
        pin: 32
      })
    });
    const body = await res.json();
    console.log('Status Code:', res.status);
    console.log('Response:', body);
    if (res.status === 400 && body.error.includes('sensor "Zone 1"')) {
      console.log('Result: SUCCESS (Blocked correctly with descriptive message)');
    } else {
      console.error('Result: FAILURE (Expected 400 conflict error)');
      process.exit(1);
    }
  } catch (err) {
    console.error('Error during Test 2:', err.message);
    process.exit(1);
  }

  console.log('\n--- ALL GPIO VALIDATION TESTS COMPLETED SUCCESSFULLY ---');
}

runTests().catch(err => {
  console.error('Validation test run failed:', err);
  process.exit(1);
});
