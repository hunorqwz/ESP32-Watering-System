import { NextResponse } from 'next/server';

let cachedAuthHeader = null;
let cachedPublishUrl = null;

function getEmqxConfig(apiUrl, apiKey, apiSecret) {
  if (!cachedAuthHeader) {
    cachedAuthHeader = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  }
  if (!cachedPublishUrl) {
    let cleanUrl = apiUrl.replace(/\/$/, '');
    if (cleanUrl.endsWith('/api/v5')) {
      cleanUrl = cleanUrl.slice(0, -7);
    }
    cachedPublishUrl = cleanUrl + '/api/v5/publish';
  }
  return { authHeader: cachedAuthHeader, publishUrl: cachedPublishUrl };
}

export async function POST(request) {
  const apiUrl = process.env.EMQX_API_URL;
  const apiKey = process.env.EMQX_API_KEY;
  const apiSecret = process.env.EMQX_API_SECRET;

  if (!apiUrl || !apiKey || !apiSecret) {
    console.error('Missing configuration: Ensure EMQX_API_URL, EMQX_API_KEY, and EMQX_API_SECRET are set.');
    return NextResponse.json(
      { success: false, error: 'API server configuration is incomplete.' },
      { status: 500 }
    );
  }

  try {
    const { authHeader, publishUrl } = getEmqxConfig(apiUrl, apiKey, apiSecret);
    const formattedPayload = { action: 'refresh_telemetry' };

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
      console.error('EMQX telemetry refresh publish rejected:', result);
      return NextResponse.json(
        { success: false, error: 'EMQX broker rejected the message publish request.', details: result },
        { status: emqxResponse.status }
      );
    }

    return NextResponse.json(
      { success: true, message: 'Telemetry refresh command published successfully.', messageId: result.id || null },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to communicate with EMQX API:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to communicate with EMQX broker.', details: error.message },
      { status: 500 }
    );
  }
}
