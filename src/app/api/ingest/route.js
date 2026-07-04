import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getReservoirVolume } from '@/lib/reservoir';

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
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is missing.');
    return NextResponse.json(
      { success: false, error: 'Database connection configuration is missing on the server.' },
      { status: 500 }
    );
  }

  const rawBody = await request.text();
  console.log('--- INCOMING TELEMETRY RAW BODY ---');
  console.log(rawBody);
  console.log('------------------------------------');
  try {
    const fs = await import('fs/promises');
    await fs.appendFile('ingest_debug.log', `${new Date().toISOString()} - RAW: ${rawBody}\n`);
  } catch (err) {
    console.error('Failed to write ingest_debug.log:', err.message);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    console.error('Ingest JSON parsing failed:', e.message, 'Raw body was:', rawBody);
    return NextResponse.json(
      { success: false, error: 'Invalid JSON payload.', details: e.message },
      { status: 400 }
    );
  }

  const { deviceId, readings, m1, m2, m3, m4, m5, temp, hum, waterLevel, water_level } = payload || {};
  const finalWaterLevel = waterLevel !== undefined ? waterLevel : water_level;

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
        m1: m1 !== undefined && m1 !== null ? Number(m1) : null,
        m2: m2 !== undefined && m2 !== null ? Number(m2) : null,
        m3: m3 !== undefined && m3 !== null ? Number(m3) : null,
        m4: m4 !== undefined && m4 !== null ? Number(m4) : null,
        m5: m5 !== undefined && m5 !== null ? Number(m5) : null,
        temp: temp !== undefined && temp !== null ? Number(temp) : null,
        hum: hum !== undefined && hum !== null ? Number(hum) : null,
        water_level: finalWaterLevel !== undefined && finalWaterLevel !== null ? Number(finalWaterLevel) : null
      };

      // Fetch dynamic configurations to map legacy logs parameters properly
      const dbSensors = await sql`
        SELECT id, type, name FROM sensor_configs 
        ORDER BY id ASC
      `;

      const moistureSensors = dbSensors.filter(s => s.type === 'moisture');
      const tempSensor = dbSensors.find(s => s.type === 'temperature');
      const humSensor = dbSensors.find(s => s.type === 'humidity');
      const waterSensor = dbSensors.find(s => s.type === 'water_level');

      if (legacyLogs.m1 !== null && moistureSensors[0]) processedReadings.push({ sensor_config_id: moistureSensors[0].id, value: legacyLogs.m1 });
      if (legacyLogs.m2 !== null && moistureSensors[1]) processedReadings.push({ sensor_config_id: moistureSensors[1].id, value: legacyLogs.m2 });
      if (legacyLogs.m3 !== null && moistureSensors[2]) processedReadings.push({ sensor_config_id: moistureSensors[2].id, value: legacyLogs.m3 });
      if (legacyLogs.m4 !== null && moistureSensors[3]) processedReadings.push({ sensor_config_id: moistureSensors[3].id, value: legacyLogs.m4 });
      if (legacyLogs.m5 !== null && moistureSensors[4]) processedReadings.push({ sensor_config_id: moistureSensors[4].id, value: legacyLogs.m5 });
      if (legacyLogs.temp !== null && tempSensor) processedReadings.push({ sensor_config_id: tempSensor.id, value: legacyLogs.temp });
      if (legacyLogs.hum !== null && humSensor) processedReadings.push({ sensor_config_id: humSensor.id, value: legacyLogs.hum });
      if (legacyLogs.water_level !== null && waterSensor) processedReadings.push({ sensor_config_id: waterSensor.id, value: legacyLogs.water_level });
    } else {
      return NextResponse.json(
        { success: false, error: 'Request must contain either an array of "readings" or legacy sensor parameters.' },
        { status: 400 }
      );
    }

    // Batch insert all readings into the relational sensor_readings table in a single query
    if (processedReadings.length > 0) {
      const sensorIds = processedReadings.map(r => r.sensor_config_id);
      const values = processedReadings.map(r => r.value);
      await sql`
        INSERT INTO sensor_readings (sensor_config_id, value, created_at)
        SELECT u.sensor_id, u.val, ${timestamp}::timestamptz
        FROM (
          SELECT unnest(${sensorIds}::int[]) as sensor_id, unnest(${values}::real[]) as val
        ) u
        WHERE u.sensor_id IN (SELECT id FROM sensor_configs)
      `;
    }

    // Calculate water usage difference if water level reading is present
    const waterSensors = await sql`
      SELECT id FROM sensor_configs WHERE type = 'water_level' LIMIT 1
    `;
    const waterSensor = waterSensors.length > 0 ? waterSensors[0] : null;

    if (waterSensor) {
      const waterReading = processedReadings.find(r => r.sensor_config_id === waterSensor.id);
      if (waterReading && waterReading.value !== null && waterReading.value !== undefined) {
        try {
          const litersNow = await getReservoirVolume(sql, parseFloat(waterReading.value));
          if (litersNow !== null) {
            // Find recent pump OFF logs (within 15 minutes) with pending (NULL) water_used_liters
            const pendingOffLogs = await sql`
              SELECT id, pump, created_at FROM command_logs
              WHERE state = 0
                AND status = 'success'
                AND water_used_liters IS NULL
                AND created_at >= NOW() - INTERVAL '15 minutes'
              ORDER BY created_at DESC
            `;

            for (const log of pendingOffLogs) {
              // Find matching ON log prior to this OFF log
              const onLog = await sql`
                SELECT start_volume_liters FROM command_logs
                WHERE pump = ${log.pump}
                  AND state = 1
                  AND status = 'success'
                  AND created_at < ${log.created_at}
                  AND start_volume_liters IS NOT NULL
                ORDER BY created_at DESC LIMIT 1
              `;
              if (onLog.length > 0) {
                const startVol = parseFloat(onLog[0].start_volume_liters);
                const waterUsed = Math.round(Math.max(0, startVol - litersNow) * 10) / 10;
                await sql`
                  UPDATE command_logs
                  SET water_used_liters = ${waterUsed}
                  WHERE id = ${log.id}
                `;
              }
            }
          }
        } catch (err) {
          console.error('Failed to calculate dynamic water usage drop on ingest:', err.message);
        }
      }
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
        const { authHeader, publishUrl } = getEmqxConfig(apiUrl, apiKey, apiSecret);

        // Fire-and-forget MQTT publish so the ESP32 is not kept waiting on connection round-trips
        fetch(publishUrl, {
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
        }).catch(err => {
          console.error('Failed to publish telemetry update to EMQX broker:', err.message);
        });
      } catch (err) {
        console.error('Failed to set up EMQX config:', err.message);
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
