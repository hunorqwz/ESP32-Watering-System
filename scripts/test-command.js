import fs from 'fs';
import path from 'path';
import handler from '../api/command.js';

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

// Setup Mock Request with a command payload
const mockRequest = {
  method: 'POST',
  body: {
    pump: 2,
    state: 1
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
  console.log('Starting mock command payload test to api/command handler...');
  console.log('Payload:', JSON.stringify(mockRequest.body, null, 2));

  if (!process.env.EMQX_API_URL || !process.env.EMQX_API_KEY || !process.env.EMQX_API_SECRET) {
    console.error('Test skipped/failed: EMQX REST API variables are not set in .env.');
    console.log('Ensure you have defined EMQX_API_URL, EMQX_API_KEY, and EMQX_API_SECRET.');
    process.exit(1);
  }

  // Execute the serverless function handler
  await handler(mockRequest, mockResponse);

  console.log('\n--- Test Result ---');
  console.log('Response Status Code:', mockResponse.statusCode);
  console.log('Response Body:', JSON.stringify(mockResponse.body, null, 2));

  if (mockResponse.statusCode === 200 && mockResponse.body?.success) {
    console.log('\nSUCCESS: Command successfully sent and published via EMQX REST API!');
  } else {
    console.error('\nFAILURE: Command publishing failed.');
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error('Test run failed with error:', err);
  process.exit(1);
});
