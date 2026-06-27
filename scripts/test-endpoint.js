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

async function runTest() {
  console.log('Starting integration test to api/ingest endpoint...');
  const payload = {
    deviceId: 'esp32_test_local',
    m1: 1500,
    m2: 2000,
    m3: 2500,
    m4: 3000,
    m5: 3200,
    temp: 24.5,
    hum: 40.2,
    waterLevel: 45.0
  };
  console.log('Payload:', JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(`${baseUrl}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    const body = await response.json().catch(() => ({}));

    console.log('\n--- Test Result ---');
    console.log('Response Status Code:', response.status);
    console.log('Response Body:', JSON.stringify(body, null, 2));

    if (response.status === 201 && body.success) {
      console.log('\nSUCCESS: Telemetry successfully ingested and recorded!');
    } else {
      console.error('\nFAILURE: Telemetry ingestion failed or was rejected.');
      process.exit(1);
    }
  } catch (error) {
    console.error('\nFAILURE: Could not connect to Next.js API server.', error.message);
    console.log(`Ensure that the Next.js development server is running at ${baseUrl}`);
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error('Test run failed with error:', err);
  process.exit(1);
});
