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
const token = process.env.API_ACCESS_TOKEN || 'default-watering-system-secure-token';

async function runTests() {
  console.log('--- STARTING SECURITY AUTHORIZATION TESTS ---');

  // Test 1: Try device config without token
  console.log('\n[Test 1] Fetching device config without token...');
  try {
    const res = await fetch(`${baseUrl}/api/device/config`);
    const body = await res.json();
    console.log('Status Code:', res.status);
    console.log('Response:', body);
    if (res.status === 401 && !body.success) {
      console.log('Result: SUCCESS (Blocked unauthenticated config query)');
    } else {
      console.error('Result: FAILURE (Expected 401 Unauthorized)');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test 1 error:', err.message);
    process.exit(1);
  }

  // Test 2: Try mqtt auth without token
  console.log('\n[Test 2] Fetching MQTT credentials without token...');
  try {
    const res = await fetch(`${baseUrl}/api/mqtt-auth`);
    const body = await res.json();
    console.log('Status Code:', res.status);
    console.log('Response:', body);
    if (res.status === 401 && !body.success) {
      console.log('Result: SUCCESS (Blocked unauthenticated MQTT credentials query)');
    } else {
      console.error('Result: FAILURE (Expected 401 Unauthorized)');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test 2 error:', err.message);
    process.exit(1);
  }

  // Test 3: Try device config WITH valid token
  console.log('\n[Test 3] Fetching device config with valid bearer token...');
  try {
    const res = await fetch(`${baseUrl}/api/device/config`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const body = await res.json();
    console.log('Status Code:', res.status);
    console.log('SSID returned:', body.wifi_ssid);
    if (res.status === 200 && body.success) {
      console.log('Result: SUCCESS (Authorized config query returned correctly)');
    } else {
      console.error('Result: FAILURE (Expected 200 OK)');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test 3 error:', err.message);
    process.exit(1);
  }

  // Test 4: Try mqtt auth WITH valid token
  console.log('\n[Test 4] Fetching MQTT credentials with valid bearer token...');
  try {
    const res = await fetch(`${baseUrl}/api/mqtt-auth`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const body = await res.json();
    console.log('Status Code:', res.status);
    if (res.status === 200 && body.success) {
      console.log('MQTT Broker URL:', body.brokerUrl);
      console.log('Result: SUCCESS (Authorized MQTT credentials returned correctly)');
    } else if (res.status === 404 && !body.success && body.error.includes('placeholder')) {
      console.log('Response:', body);
      console.log('Result: SUCCESS (Authorized query passed, but returned expected 404 due to placeholder credentials)');
    } else {
      console.error('Result: FAILURE (Expected 200 OK or 404 Placeholder)');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test 4 error:', err.message);
    process.exit(1);
  }

  console.log('\n--- ALL SECURITY TESTS COMPLETED SUCCESSFULLY ---');
}

runTests().catch(err => {
  console.error('Security verification run failed:', err);
  process.exit(1);
});
