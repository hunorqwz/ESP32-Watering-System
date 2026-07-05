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

export async function POST(request) {
  try {
    const payload = await request.json();
    const { id, name, type, pin, pin_secondary, dry_limit, wet_limit, pump_id, force } = payload || {};

    if (!name || !type || pin === undefined) {
      return NextResponse.json(
        { success: false, error: 'Missing parameters. name, type, and pin are required.' },
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

    const parsedPinSecondary = pin_secondary !== undefined && pin_secondary !== null && String(pin_secondary).trim() !== '' ? parseInt(pin_secondary, 10) : null;
    const pinSecondary = isNaN(parsedPinSecondary) ? null : parsedPinSecondary;

    // Auto-calculate sensor group based on type
    let calculatedGroup = 'General';
    if (type === 'moisture') {
      calculatedGroup = 'Soil Moisture';
    } else if (type === 'temperature' || type === 'humidity') {
      calculatedGroup = 'Environment';
    } else if (type === 'water_level') {
      calculatedGroup = 'Reservoir';
    }

    // Collect list of requested pins to validate
    const requestedPins = [parsedPin];
    if (pinSecondary !== null) {
      requestedPins.push(pinSecondary);
    }

    // 1. Check for pin overlaps with other sensors
    const sensorConflicts = id
      ? await sql`
          SELECT name, type FROM sensor_configs
          WHERE (pin = ANY(${requestedPins}::int[]) OR pin_secondary = ANY(${requestedPins}::int[]))
            AND id != ${parseInt(id, 10)}
        `
      : await sql`
          SELECT name, type FROM sensor_configs
          WHERE (pin = ANY(${requestedPins}::int[]) OR pin_secondary = ANY(${requestedPins}::int[]))
        `;

    let hasHardConflict = false;
    let hasSoftConflict = false;
    let conflictDetails = '';

    if (sensorConflicts.length > 0) {
      const conflictingSensorNames = [];
      for (const conflict of sensorConflicts) {
        // Digital shareable types (like temp & humidity sharing a DHT22 pin or I2C bus)
        const isShareableType = (type === 'temperature' || type === 'humidity') && 
                                (conflict.type === 'temperature' || conflict.type === 'humidity');
        if (!isShareableType) {
          hasHardConflict = true;
          conflictDetails = `GPIO Conflict: Pin is already allocated to sensor "${conflict.name}" (Type: ${conflict.type}). Analog or ultrasonic pins cannot be shared.`;
          break;
        } else {
          hasSoftConflict = true;
          conflictingSensorNames.push(conflict.name);
        }
      }
      if (hasSoftConflict && !hasHardConflict) {
        const joinedNames = conflictingSensorNames.map(n => `"${n}"`).join(' and ');
        conflictDetails = `GPIO Warning: Pin is shared with sensor ${joinedNames}. Ensure this is a shared bus (e.g. I2C) or a combined sensor (e.g. DHT22).`;
      }
    }

    // 2. Check for pin overlaps with configured pumps (always a hard block)
    const pumpConflicts = await sql`
      SELECT name FROM pump_configs
      WHERE pin = ANY(${requestedPins}::int[])
    `;

    if (pumpConflicts.length > 0) {
      hasHardConflict = true;
      conflictDetails = `GPIO Conflict: Pin is already allocated to pump "${pumpConflicts[0].name}". Pumps and sensors cannot share pins.`;
    }

    if (hasHardConflict) {
      return NextResponse.json(
        { success: false, error: conflictDetails },
        { status: 400 }
      );
    }

    if (hasSoftConflict && force !== true) {
      return NextResponse.json({
        success: false,
        needsForce: true,
        warning: conflictDetails
      });
    }

    const dryVal = dry_limit !== undefined && dry_limit !== null && String(dry_limit).trim() !== '' ? parseInt(dry_limit, 10) : null;
    const wetVal = wet_limit !== undefined && wet_limit !== null && String(wet_limit).trim() !== '' ? parseInt(wet_limit, 10) : null;
    const dry = isNaN(dryVal) ? null : dryVal;
    const wet = isNaN(wetVal) ? null : wetVal;
    
    const parsedPumpId = pump_id !== undefined && pump_id !== null && String(pump_id).trim() !== '' ? parseInt(pump_id, 10) : null;
    const pumpIdVal = isNaN(parsedPumpId) ? null : parsedPumpId;

    if (id) {
      // Update existing sensor config
      await sql`
        UPDATE sensor_configs 
        SET name = ${name}, type = ${type}, pin = ${parsedPin}, pin_secondary = ${pinSecondary}, sensor_group = ${calculatedGroup}, dry_limit = ${dry}, wet_limit = ${wet}, pump_id = ${pumpIdVal}
        WHERE id = ${parseInt(id, 10)}
      `;
      await triggerReload();
      return NextResponse.json({ success: true, message: 'Sensor configuration updated successfully.' });
    } else {
      // Insert new sensor config
      await sql`
        INSERT INTO sensor_configs (name, type, pin, pin_secondary, sensor_group, dry_limit, wet_limit, pump_id)
        VALUES (${name}, ${type}, ${parsedPin}, ${pinSecondary}, ${calculatedGroup}, ${dry}, ${wet}, ${pumpIdVal})
      `;
      await triggerReload();
      return NextResponse.json({ success: true, message: 'Sensor added successfully.' });
    }
  } catch (error) {
    console.error('Failed to save sensor configuration:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to write sensor configuration.', details: error.message },
      { status: 500 }
    );
  }
}

// Delete Sensor
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
      DELETE FROM sensor_configs 
      WHERE id = ${parseInt(id, 10)}
    `;

    await triggerReload();
    return NextResponse.json({ success: true, message: 'Sensor configuration deleted successfully.' });
  } catch (error) {
    console.error('Failed to delete sensor configuration:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete sensor config.', details: error.message },
      { status: 500 }
    );
  }
}
