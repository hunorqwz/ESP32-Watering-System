import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(request) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is missing.');
    return NextResponse.json(
      { success: false, error: 'Database connection configuration is missing on the server.' },
      { status: 500 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON payload.' },
      { status: 400 }
    );
  }

  const { deviceId, readings, m1, m2, m3, m4, m5, temp, hum, waterLevel } = payload || {};

  if (!deviceId) {
    return NextResponse.json(
      { success: false, error: 'Missing required field: "deviceId".' },
      { status: 400 }
    );
  }

  const sql = getDb();
  const timestamp = new Date().toISOString();

  try {
    let processedReadings = []; // Array of { sensor_config_id, value }

    // 1. Dynamic Relational Format Handler
    if (Array.isArray(readings)) {
      for (const item of readings) {
        const sensorId = parseInt(item.sensorId, 10);
        const value = parseFloat(item.value);
        if (!isNaN(sensorId) && !isNaN(value)) {
          processedReadings.push({ sensor_config_id: sensorId, value: value });
        }
      }
    } 
    // 2. Legacy Fallback Handler (If ESP32 sends the old format)
    else if (m1 !== undefined || m2 !== undefined || m3 !== undefined || m4 !== undefined || m5 !== undefined) {
      const legacyLogs = {
        m1: Number(m1 || 0),
        m2: Number(m2 || 0),
        m3: Number(m3 || 0),
        m4: Number(m4 || 0),
        m5: Number(m5 || 0),
        temp: temp !== undefined && temp !== null ? Number(temp) : null,
        hum: hum !== undefined && hum !== null ? Number(hum) : null,
        water_level: waterLevel !== undefined && waterLevel !== null ? Number(waterLevel) : null
      };

      // Write to legacy sensor_logs table to support legacy tools
      await sql`
        INSERT INTO sensor_logs (
          device_id, m1, m2, m3, m4, m5, temp, hum, water_level
        ) VALUES (
          ${deviceId}, ${legacyLogs.m1}, ${legacyLogs.m2}, ${legacyLogs.m3}, ${legacyLogs.m4}, ${legacyLogs.m5}, ${legacyLogs.temp}, ${legacyLogs.hum}, ${legacyLogs.water_level}
        )
      `;

      // Map to default seeded relational config IDs
      // ID mappings: 1=Zone 1, 2=Zone 2, 3=Zone 3, 4=Zone 4, 5=Zone 5, 6=Temp, 7=Hum, 8=WaterLevel
      processedReadings.push({ sensor_config_id: 1, value: legacyLogs.m1 });
      processedReadings.push({ sensor_config_id: 2, value: legacyLogs.m2 });
      processedReadings.push({ sensor_config_id: 3, value: legacyLogs.m3 });
      processedReadings.push({ sensor_config_id: 4, value: legacyLogs.m4 });
      processedReadings.push({ sensor_config_id: 5, value: legacyLogs.m5 });
      if (legacyLogs.temp !== null) processedReadings.push({ sensor_config_id: 6, value: legacyLogs.temp });
      if (legacyLogs.hum !== null) processedReadings.push({ sensor_config_id: 7, value: legacyLogs.hum });
      if (legacyLogs.water_level !== null) processedReadings.push({ sensor_config_id: 8, value: legacyLogs.water_level });
    } else {
      return NextResponse.json(
        { success: false, error: 'Request must contain either an array of "readings" or legacy sensor parameters.' },
        { status: 400 }
      );
    }

    // Insert all readings into the relational sensor_readings table
    if (processedReadings.length > 0) {
      await Promise.all(
        processedReadings.map(reading => 
          sql`
            INSERT INTO sensor_readings (sensor_config_id, value, created_at)
            VALUES (${reading.sensor_config_id}, ${reading.value}, ${timestamp})
          `
        )
      );
    }

    // Fetch current telemetry configuration to return to ESP32
    const configs = await sql`
      SELECT value FROM system_config 
      WHERE key = 'telemetry_interval_minutes'
    `;
    const intervalMinutes = configs.length > 0 ? parseInt(configs[0].value, 10) : 15;

    // Build flat readings object for real-time WebSocket dashboard compatibility
    const flatReadings = {};
    processedReadings.forEach(r => {
      flatReadings[r.sensor_config_id] = r.value;
    });

    const telemetryPayload = {
      device_id: deviceId,
      readings: flatReadings,
      created_at: timestamp
    };

    // Publish telemetry payload to EMQX MQTT broker
    const apiUrl = process.env.EMQX_API_URL;
    const apiKey = process.env.EMQX_API_KEY;
    const apiSecret = process.env.EMQX_API_SECRET;

    if (apiUrl && apiKey && apiSecret) {
      try {
        const authHeader = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
        let cleanUrl = apiUrl.replace(/\/$/, '');
        if (cleanUrl.endsWith('/api/v5')) {
          cleanUrl = cleanUrl.slice(0, -7);
        }
        const publishUrl = cleanUrl + '/api/v5/publish';

        await fetch(publishUrl, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            topic: 'device/telemetry',
            qos: 0,
            payload: JSON.stringify(telemetryPayload),
            payload_encoding: 'plain'
          }),
          signal: AbortSignal.timeout(4000)
        });
      } catch (err) {
        console.error('Failed to publish telemetry update to EMQX broker:', err.message);
      }
    }

    return NextResponse.json(
      { 
        success: true, 
        message: 'Telemetry data successfully recorded.',
        telemetry_interval_minutes: intervalMinutes
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Telemetry ingest processing error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to write telemetry data to the database.', details: error.message },
      { status: 500 }
    );
  }
}
