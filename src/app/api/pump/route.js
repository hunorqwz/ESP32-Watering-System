import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

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

async function triggerReload() {
  const apiUrl = process.env.EMQX_API_URL;
  const apiKey = process.env.EMQX_API_KEY;
  const apiSecret = process.env.EMQX_API_SECRET;

  if (apiUrl && apiKey && apiSecret) {
    try {
      const { authHeader, publishUrl } = getEmqxConfig(apiUrl, apiKey, apiSecret);
      await fetch(publishUrl, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          topic: 'device/commands',
          qos: 1,
          payload: JSON.stringify({ action: 'reload_config' }),
          payload_encoding: 'plain'
        }),
        signal: AbortSignal.timeout(4000)
      });
      console.log('Successfully published reload_config command via MQTT.');
    } catch (err) {
      console.error('Failed to publish reload_config command:', err.message);
    }
  }
}

// Create or Update Pump
export async function POST(request) {
  try {
    const payload = await request.json();
    const { id, name, pin, flow_rate_lpm } = payload || {};

    if (!name || pin === undefined) {
      return NextResponse.json(
        { success: false, error: 'Missing parameters. "name" and "pin" are required.' },
        { status: 400 }
      );
    }

    const sql = getDb();
    const parsedPin = parseInt(pin, 10);
    if (isNaN(parsedPin)) {
      return NextResponse.json(
        { success: false, error: 'Invalid pin assignment. Pin must be a valid integer.' },
        { status: 400 }
      );
    }

    const parsedFlowRate = flow_rate_lpm !== undefined && flow_rate_lpm !== null && String(flow_rate_lpm).trim() !== ''
      ? parseFloat(flow_rate_lpm)
      : 4.0;
    const finalFlowRate = isNaN(parsedFlowRate) || parsedFlowRate <= 0 ? 4.0 : parsedFlowRate;

    // 1. Check for pin overlaps with other pumps
    const pumpConflicts = id
      ? await sql`
          SELECT name FROM pump_configs
          WHERE pin = ${parsedPin}
            AND id != ${parseInt(id, 10)}
        `
      : await sql`
          SELECT name FROM pump_configs
          WHERE pin = ${parsedPin}
        `;

    if (pumpConflicts.length > 0) {
      return NextResponse.json(
        { success: false, error: `GPIO Conflict: Pin is already allocated to pump "${pumpConflicts[0].name}".` },
        { status: 400 }
      );
    }

    // 2. Check for pin overlaps with configured sensors
    const sensorConflicts = await sql`
      SELECT name FROM sensor_configs
      WHERE pin = ${parsedPin} OR pin_secondary = ${parsedPin}
    `;

    if (sensorConflicts.length > 0) {
      return NextResponse.json(
        { success: false, error: `GPIO Conflict: Pin is already allocated to sensor "${sensorConflicts[0].name}".` },
        { status: 400 }
      );
    }

    if (id) {
      // Update existing pump config
      await sql`
        UPDATE pump_configs 
        SET name = ${name}, pin = ${parsedPin}, flow_rate_lpm = ${finalFlowRate}
        WHERE id = ${parseInt(id, 10)}
      `;
      await triggerReload();
      return NextResponse.json({ success: true, message: 'Pump configuration updated successfully.' });
    } else {
      // Insert new pump config
      await sql`
        INSERT INTO pump_configs (name, pin, flow_rate_lpm)
        VALUES (${name}, ${parsedPin}, ${finalFlowRate})
      `;
      await triggerReload();
      return NextResponse.json({ success: true, message: 'Pump added successfully.' });
    }
  } catch (error) {
    console.error('Failed to save pump configuration:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to write pump configuration.', details: error.message },
      { status: 500 }
    );
  }
}

// Delete Pump
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Missing parameter: "id" is required.' },
        { status: 400 }
      );
    }

    const sql = getDb();
    await sql`
      DELETE FROM pump_configs 
      WHERE id = ${parseInt(id, 10)}
    `;

    await triggerReload();
    return NextResponse.json({ success: true, message: 'Pump configuration deleted successfully.' });
  } catch (error) {
    console.error('Failed to delete pump configuration:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete pump config.', details: error.message },
      { status: 500 }
    );
  }
}
