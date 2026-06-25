import { neon } from '@neondatabase/serverless';

// Cache basic authentication headers, URL endpoint, and Neon SQL client to optimize performance
let cachedAuthHeader = null;
let cachedPublishUrl = null;
let cachedSql = null;

function getEmqxConfig(apiUrl, apiKey, apiSecret) {
  if (!cachedAuthHeader) {
    cachedAuthHeader = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  }
  if (!cachedPublishUrl) {
    cachedPublishUrl = apiUrl.replace(/\/$/, '') + '/api/v5/publish';
  }
  return { authHeader: cachedAuthHeader, publishUrl: cachedPublishUrl };
}

function getSqlClient(databaseUrl) {
  if (!cachedSql) {
    cachedSql = neon(databaseUrl);
  }
  return cachedSql;
}

export default async function handler(request, response) {
  // Ensure we only process POST requests
  if (request.method !== 'POST') {
    response.setHeader('Allow', ['POST']);
    return response.status(405).json({
      success: false,
      error: `Method ${request.method} Not Allowed. Use POST.`
    });
  }

  // Verify EMQX REST API credentials and NeonDB URL are configured
  const apiUrl = process.env.EMQX_API_URL;
  const apiKey = process.env.EMQX_API_KEY;
  const apiSecret = process.env.EMQX_API_SECRET;
  const databaseUrl = process.env.DATABASE_URL;

  if (!apiUrl || !apiKey || !apiSecret || !databaseUrl) {
    console.error('Missing configuration: Ensure EMQX_API_URL, EMQX_API_KEY, EMQX_API_SECRET, and DATABASE_URL are set.');
    return response.status(500).json({
      success: false,
      error: 'API server configuration is incomplete.'
    });
  }

  // Extract the command payload
  let payload = request.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      return response.status(400).json({
        success: false,
        error: 'Invalid JSON payload in request body.'
      });
    }
  }

  const { pump, state } = payload || {};

  // Validate the command payload
  // Reject booleans explicitly to prevent invalid coercion (e.g. true coerced to 1)
  if (typeof pump === 'boolean' || typeof state === 'boolean') {
    return response.status(400).json({
      success: false,
      error: 'Invalid parameter types. Booleans are not allowed for pump or state.'
    });
  }

  // 1. pump must be an integer in 1-4
  const parsedPump = Number(pump);
  if (pump === undefined || !Number.isInteger(parsedPump) || parsedPump < 1 || parsedPump > 4) {
    return response.status(400).json({
      success: false,
      error: 'Invalid "pump" value. It must be an integer between 1 and 4.'
    });
  }

  // 2. state must be 0 or 1
  const parsedState = Number(state);
  if (state === undefined || !Number.isInteger(parsedState) || (parsedState !== 0 && parsedState !== 1)) {
    return response.status(400).json({
      success: false,
      error: 'Invalid "state" value. It must be either 0 or 1.'
    });
  }

  // Initialize the database client
  const sql = getSqlClient(databaseUrl);
  let status = 'failed';
  let messageId = null;
  let errorDetails = null;

  try {
    // Get cached EMQX config values
    const { authHeader, publishUrl } = getEmqxConfig(apiUrl, apiKey, apiSecret);

    // Format target MQTT payload strictly as {"pump": <1-4>, "state": <0 or 1>}
    const formattedPayload = { pump: parsedPump, state: parsedState };

    // Publish MQTT message to device/commands topic on EMQX REST API
    const emqxResponse = await fetch(publishUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        topic: 'device/commands',
        qos: 1,
        payload: JSON.stringify(formattedPayload),
        payload_encoding: 'plain'
      })
    });

    const result = await emqxResponse.json().catch(() => ({}));

    if (!emqxResponse.ok) {
      errorDetails = result ? JSON.stringify(result) : `HTTP Error ${emqxResponse.status}`;
      console.error('EMQX publish rejected:', result);
      
      // Log failed execution in the database for tracking
      await sql`
        INSERT INTO command_logs (pump, state, status, error_details)
        VALUES (${parsedPump}, ${parsedState}, ${status}, ${errorDetails})
      `;

      return response.status(emqxResponse.status).json({
        success: false,
        error: 'EMQX broker rejected the message publish request.',
        details: result
      });
    }

    status = 'success';
    messageId = result.id || null;

    // Log successful execution in the database for tracking
    await sql`
      INSERT INTO command_logs (pump, state, status, response_msg_id)
      VALUES (${parsedPump}, ${parsedState}, ${status}, ${messageId})
    `;

    return response.status(200).json({
      success: true,
      message: 'Command successfully published and logged.',
      messageId: messageId
    });
  } catch (error) {
    console.error('Failed to communicate with EMQX API or database:', error);
    errorDetails = error.message;

    try {
      // Log connection error in the database
      await sql`
        INSERT INTO command_logs (pump, state, status, error_details)
        VALUES (${parsedPump}, ${parsedState}, ${status}, ${errorDetails})
      `;
    } catch (dbError) {
      console.error('Failed to write execution log to database:', dbError);
    }

    return response.status(500).json({
      success: false,
      error: 'Failed to communicate with EMQX broker or log history.',
      details: error.message
    });
  }
}
