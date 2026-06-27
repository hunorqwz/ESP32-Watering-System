import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

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



export async function POST(request) {
  const apiUrl = process.env.EMQX_API_URL;
  const apiKey = process.env.EMQX_API_KEY;
  const apiSecret = process.env.EMQX_API_SECRET;
  const databaseUrl = process.env.DATABASE_URL;

  if (!apiUrl || !apiKey || !apiSecret || !databaseUrl) {
    console.error('Missing configuration: Ensure EMQX_API_URL, EMQX_API_KEY, EMQX_API_SECRET, and DATABASE_URL are set.');
    return NextResponse.json(
      { success: false, error: 'API server configuration is incomplete.' },
      { status: 500 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON payload in request body.' },
      { status: 400 }
    );
  }

  const { pump, state } = payload || {};

  // Validate the command payload
  if (typeof pump === 'boolean' || typeof state === 'boolean') {
    return NextResponse.json(
      { success: false, error: 'Invalid parameter types. Booleans are not allowed for pump or state.' },
      { status: 400 }
    );
  }

  const parsedPump = Number(pump);
  if (pump === undefined || !Number.isInteger(parsedPump) || parsedPump < 1) {
    return NextResponse.json(
      { success: false, error: 'Invalid "pump" value. It must be a valid positive integer.' },
      { status: 400 }
    );
  }

  const parsedState = Number(state);
  if (state === undefined || !Number.isInteger(parsedState) || (parsedState !== 0 && parsedState !== 1)) {
    return NextResponse.json(
      { success: false, error: 'Invalid "state" value. It must be either 0 or 1.' },
      { status: 400 }
    );
  }

  const sql = getDb();

  // Validate that the pump actually exists in database configuration
  try {
    const pumpRecord = await sql`
      SELECT id FROM pump_configs WHERE id = ${parsedPump}
    `;
    if (pumpRecord.length === 0) {
      return NextResponse.json(
        { success: false, error: `Invalid "pump" value. Pump ID ${parsedPump} does not exist in configuration.` },
        { status: 400 }
      );
    }
  } catch (dbErr) {
    console.error('Failed to verify pump existence in database:', dbErr);
    return NextResponse.json(
      { success: false, error: 'Failed to verify pump configuration from database.', details: dbErr.message },
      { status: 500 }
    );
  }

  let status = 'failed';
  let messageId = null;
  let errorDetails = null;

  try {
    const { authHeader, publishUrl } = getEmqxConfig(apiUrl, apiKey, apiSecret);
    const formattedPayload = { pump: parsedPump, state: parsedState };

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
      }),
      signal: AbortSignal.timeout(5000)
    });

    const result = await emqxResponse.json().catch(() => ({}));

    if (!emqxResponse.ok) {
      errorDetails = result ? JSON.stringify(result) : `HTTP Error ${emqxResponse.status}`;
      console.error('EMQX publish rejected:', result);
      
      await sql`
        INSERT INTO command_logs (pump, state, status, error_details)
        VALUES (${parsedPump}, ${parsedState}, ${status}, ${errorDetails})
      `;

      return NextResponse.json(
        { success: false, error: 'EMQX broker rejected the message publish request.', details: result },
        { status: emqxResponse.status }
      );
    }

    status = 'success';
    messageId = result.id || null;

    // Concurrently update pump state and log command execution status
    await Promise.all([
      sql`
        UPDATE pump_configs
        SET state = ${parsedState}
        WHERE id = ${parsedPump}
      `,
      sql`
        INSERT INTO command_logs (pump, state, status, response_msg_id)
        VALUES (${parsedPump}, ${parsedState}, ${status}, ${messageId})
      `
    ]);

    return NextResponse.json(
      { success: true, message: 'Command successfully published, state updated, and logged.', messageId: messageId },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to communicate with EMQX API or database:', error);
    errorDetails = error.message;

    try {
      await sql`
        INSERT INTO command_logs (pump, state, status, error_details)
        VALUES (${parsedPump}, ${parsedState}, ${status}, ${errorDetails})
      `;
    } catch (dbError) {
      console.error('Failed to write execution log to database:', dbError);
    }

    return NextResponse.json(
      { success: false, error: 'Failed to communicate with EMQX broker or log history.', details: error.message },
      { status: 500 }
    );
  }
}
