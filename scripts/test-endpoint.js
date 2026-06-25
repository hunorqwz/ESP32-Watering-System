import fs from 'fs';
import path from 'path';
import handler from '../api/ingest.js';

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
        if (val.endsWith('\r')) val = val.slice(0, -1); // Handle Windows CRLF
        // Remove surrounding quotes if present
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

// Setup Mock Request mimicking the EMQX JSON payload format
const mockRequest = {
  method: 'POST',
  body: {
    deviceId: 'esp32_test_local',
    m1: 45,
    m2: 50,
    m3: 30,
    m4: 60,
    m5: 55,
    temp: 24.5,
    hum: 40.2,
    waterLevel: 30
  }
};

// Setup Mock Response
const mockResponse = {
  statusCode: 200,
  headers: {},
  setHeader(name, value) {
    this.headers[name] = value;
    return this;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(data) {
    this.body = data;
    return this;
  }
};

async function runTest() {
  console.log('Starting mock telemetry payload test to api/ingest handler...');
  console.log('Payload:', JSON.stringify(mockRequest.body, null, 2));

  if (!process.env.DATABASE_URL) {
    console.error('Test failed: DATABASE_URL is not set. Make sure .env is populated.');
    process.exit(1);
  }

  // Execute the serverless function handler
  await handler(mockRequest, mockResponse);

  console.log('\n--- Test Result ---');
  console.log('Response Status Code:', mockResponse.statusCode);
  console.log('Response Body:', JSON.stringify(mockResponse.body, null, 2));

  if (mockResponse.statusCode === 201 && mockResponse.body?.success) {
    console.log('\nSUCCESS: Ingestion handler successfully recorded the mock sensor logs to NeonDB!');
  } else {
    console.error('\nFAILURE: Handler failed to process and insert the payload.');
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error('Test run failed with error:', err);
  process.exit(1);
});
