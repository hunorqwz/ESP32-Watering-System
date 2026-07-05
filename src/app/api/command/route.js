import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getReservoirVolume } from '@/lib/reservoir';

let cachedAuthHeader = null;
let cachedPublishUrl = null;
let cachedSql = null;

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

  let pumpName = 'Unknown Pump';
  let pumpPin = 0;

  let flowRateLpm = 4.0;

  // Validate that the pump actually exists in database configuration
  try {
    const pumpRecord = await sql`
      SELECT id, name, pin, flow_rate_lpm FROM pump_configs WHERE id = ${parsedPump}
    `;
    if (pumpRecord.length === 0) {
      return NextResponse.json(
        { success: false, error: `Invalid "pump" value. Pump ID ${parsedPump} does not exist in configuration.` },
        { status: 400 }
      );
    }
    pumpName = pumpRecord[0].name;
    pumpPin = pumpRecord[0].pin;
    flowRateLpm = pumpRecord[0].flow_rate_lpm !== null && pumpRecord[0].flow_rate_lpm !== undefined 
      ? parseFloat(pumpRecord[0].flow_rate_lpm) 
      : 4.0;
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

  // Calculate duration and water usage if transitioning to OFF
  let durationSeconds = null;
  let waterUsedLiters = null;
  let startVolumeLiters = null;

  if (parsedState === 1) {
    try {
      const waterSensor = await sql`
        SELECT id FROM sensor_configs WHERE type = 'water_level' LIMIT 1
      `;
      if (waterSensor.length > 0) {
        const latestReading = await sql`
          SELECT value FROM sensor_readings 
          WHERE sensor_config_id = ${waterSensor[0].id} 
          ORDER BY created_at DESC LIMIT 1
        `;
        if (latestReading.length > 0) {
          startVolumeLiters = await getReservoirVolume(sql, parseFloat(latestReading[0].value));
        }
      }

      // Safeguard: Check if reservoir level is below minimum safety limit
      if (startVolumeLiters !== null) {
        const minVolConfig = await sql`
          SELECT value FROM system_config WHERE key = 'reservoir_min_volume_liters'
        `;
        const minVol = minVolConfig.length > 0 ? parseFloat(minVolConfig[0].value) : 5.0;
        if (startVolumeLiters < minVol) {
          // Log failed action and block
          await sql`
            INSERT INTO command_logs (pump, pump_name, pump_pin, state, status, error_details, start_volume_liters)
            VALUES (${parsedPump}, ${pumpName}, ${pumpPin}, 1, 'failed', 'Locked: Reservoir is empty. Command blocked.', ${startVolumeLiters})
          `;
          return NextResponse.json(
            { success: false, error: `Locked: Reservoir volume (${startVolumeLiters}L) is below safety limit (${minVol}L).` },
            { status: 400 }
          );
        }
      }
    } catch (err) {
      console.error('Failed to pre-calculate start reservoir volume:', err.message);
    }
  }

  if (parsedState === 0) {
    try {
      const lastOnLog = await sql`
        SELECT created_at FROM command_logs
        WHERE pump = ${parsedPump} AND state = 1 AND status = 'success'
        ORDER BY created_at DESC LIMIT 1
      `;
      if (lastOnLog.length > 0) {
        const onTime = new Date(lastOnLog[0].created_at).getTime();
        const offTime = Date.now();
        durationSeconds = Math.max(0, Math.floor((offTime - onTime) / 1000));
        
        // Defer to literal sensor difference if water level sensor exists,
        // otherwise fallback to flow rate estimate.
        const waterSensor = await sql`
          SELECT id FROM sensor_configs WHERE type = 'water_level' LIMIT 1
        `;
        if (waterSensor.length === 0) {
          waterUsedLiters = Math.round(((durationSeconds / 60) * flowRateLpm) * 10) / 10;
        }
      }
    } catch (calcErr) {
      console.error('Failed to calculate pump runtime stats:', calcErr.message);
    }
  }

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
        INSERT INTO command_logs (pump, pump_name, pump_pin, state, status, error_details)
        VALUES (${parsedPump}, ${pumpName}, ${pumpPin}, ${parsedState}, ${status}, ${errorDetails})
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
        INSERT INTO command_logs (pump, pump_name, pump_pin, state, status, response_msg_id, duration_seconds, water_used_liters, start_volume_liters)
        VALUES (${parsedPump}, ${pumpName}, ${pumpPin}, ${parsedState}, ${status}, ${messageId}, ${durationSeconds}, ${waterUsedLiters}, ${startVolumeLiters})
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
        INSERT INTO command_logs (pump, pump_name, pump_pin, state, status, error_details)
        VALUES (${parsedPump}, ${pumpName}, ${pumpPin}, ${parsedState}, ${status}, ${errorDetails})
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

export async function DELETE() {
  try {
    const sql = getDb();
    await sql`DELETE FROM command_logs`;
    return NextResponse.json({ success: true, message: 'System activity log cleared successfully.' });
  } catch (error) {
    console.error('Failed to clear command logs:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to clear activity log from database.', details: error.message },
      { status: 500 }
    );
  }
}
