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

async function publishMqttCommand(apiUrl, apiKey, apiSecret, pumpId, state) {
  const { authHeader, publishUrl } = getEmqxConfig(apiUrl, apiKey, apiSecret);
  const formattedPayload = { pump: pumpId, state: state };

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

  if (!emqxResponse.ok) {
    const text = await emqxResponse.text();
    throw new Error(`MQTT Broker reject: ${emqxResponse.status} - ${text}`);
  }

  const json = await emqxResponse.json();
  return json.id || null;
}

export async function GET(request) {
  // CRON_SECRET authorization check
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    const urlToken = new URL(request.url).searchParams.get('token');
    
    if (authHeader !== `Bearer ${cronSecret}` && urlToken !== cronSecret) {
      return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }
  }

  const apiUrl = process.env.EMQX_API_URL;
  const apiKey = process.env.EMQX_API_KEY;
  const apiSecret = process.env.EMQX_API_SECRET;
  const sql = getDb();

  const triggersRun = [];
  const sweepsRun = [];

  try {
    // 1. Load system configurations
    const rawConfigs = await sql`SELECT key, value FROM system_config`;
    const configMap = {};
    rawConfigs.forEach(c => {
      configMap[c.key] = c.value;
    });

    const timezone = configMap['timezone'] || 'Europe/Bucharest';
    const now = new Date();
    
    // YYYY-MM-DD local format
    const localDateStr = now.toLocaleDateString('sv-SE', { timeZone: timezone }); 
    let localTimeStr = now.toLocaleTimeString('en-US', { timeZone: timezone, hour12: false });
    
    // Day of week: 1 (Mon) - 7 (Sun)
    const weekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' });
    const weekdayName = weekdayFormatter.format(now);
    const dayMap = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7 };
    let localDayOfWeek = dayMap[weekdayName];

    // Allow testing overrides
    const urlParams = new URL(request.url).searchParams;
    const simTime = urlParams.get('simulated_time'); // e.g. "08:00"
    const simDay = urlParams.get('simulated_day'); // e.g. "2"
    
    if (simTime) {
      localTimeStr = `${simTime}:00`;
    }
    if (simDay) {
      localDayOfWeek = parseInt(simDay, 10);
    }

    const [localHour, localMinute] = localTimeStr.split(':').map(Number);
    const timeMatchPrefix = `${String(localHour).padStart(2, '0')}:${String(localMinute).padStart(2, '0')}:`;

    console.log(`Cron execution run at UTC ${now.toISOString()} | Local Time: ${localDateStr} ${localTimeStr} | Weekday: ${weekdayName} (${localDayOfWeek})`);

    // 2. Fetch today's weather forecast to check for skip rules
    const forecastRows = await sql`
      SELECT * FROM weather_forecast_cache
      WHERE forecast_date = ${localDateStr}::date
    `;
    
    let willRain = false;
    let rainReason = '';
    if (forecastRows.length > 0) {
      const prob = parseFloat(forecastRows[0].precipitation_probability);
      const mm = parseFloat(forecastRows[0].expected_precipitation_mm);
      if (prob > 0.50 && mm >= 2.0) {
        willRain = true;
        rainReason = `Heavy rain forecast (${Math.round(prob * 100)}% chance, ${mm}mm).`;
      }
    }

    // 2b. Evaluate Soil Moisture Skip Rules
    let avgMoisture = null;
    let skipReasonMoisture = '';
    let willSkipMoisture = false;
    
    const moistureThreshold = configMap['moisture_skip_threshold_percent'] ? parseInt(configMap['moisture_skip_threshold_percent'], 10) : 70;
    
    if (moistureThreshold < 100) {
      const moistureSensors = await sql`
        SELECT id, dry_limit, wet_limit FROM sensor_configs WHERE type = 'moisture'
      `;
      if (moistureSensors.length > 0) {
        const sensorIds = moistureSensors.map(s => s.id);
        const latestReadings = await sql`
          SELECT DISTINCT ON (sensor_config_id) 
            sensor_config_id, value 
          FROM sensor_readings 
          WHERE sensor_config_id = ANY(${sensorIds})
          ORDER BY sensor_config_id, created_at DESC
        `;
        
        const readingsMap = {};
        latestReadings.forEach(r => {
          readingsMap[r.sensor_config_id] = parseFloat(r.value);
        });
        
        let totalMoisture = 0;
        let count = 0;
        moistureSensors.forEach(s => {
          const raw = readingsMap[s.id];
          if (raw !== undefined) {
            const dry = s.dry_limit !== null && s.dry_limit !== undefined ? s.dry_limit : 3400;
            const wet = s.wet_limit !== null && s.wet_limit !== undefined ? s.wet_limit : 1100;
            if (dry !== wet) {
              let pct = 0;
              if (dry > wet) {
                pct = raw >= dry ? 0 : raw <= wet ? 100 : Math.round(((dry - raw) / (dry - wet)) * 100);
              } else {
                pct = raw <= dry ? 0 : raw >= wet ? 100 : Math.round(((raw - dry) / (wet - dry)) * 100);
              }
              totalMoisture += pct;
              count++;
            }
          }
        });
        
        if (count > 0) {
          avgMoisture = Math.round(totalMoisture / count);
          if (avgMoisture > moistureThreshold) {
            willSkipMoisture = true;
            skipReasonMoisture = `Soil moisture is high (${avgMoisture}%, threshold: ${moistureThreshold}%).`;
          }
        }
      }
    }

    // 3. Fetch all active schedules
    const schedules = await sql`
      SELECT * FROM watering_schedules 
      WHERE enabled = true
    `;

    // Filter schedules matching current local time and day of week
    const matchingSchedules = schedules.filter(s => {
      if (!s.days_of_week.includes(localDayOfWeek)) return false;
      return s.time_of_day.startsWith(timeMatchPrefix);
    });

    // Get fallback water sensor details for start volume
    const waterSensor = await sql`
      SELECT id FROM sensor_configs WHERE type = 'water_level' LIMIT 1
    `;
    let currentVolume = null;
    if (waterSensor.length > 0) {
      const latestReading = await sql`
        SELECT value FROM sensor_readings 
        WHERE sensor_config_id = ${waterSensor[0].id} 
        ORDER BY created_at DESC LIMIT 1
      `;
      if (latestReading.length > 0) {
        currentVolume = await getReservoirVolume(sql, parseFloat(latestReading[0].value));
      }
    }

    // 4. Trigger active schedules ON (or skip them)
    for (const sched of matchingSchedules) {
      const pumpIds = sched.pump_ids || [];
      for (const pumpId of pumpIds) {
        // Fetch pump config
        const pumpRecords = await sql`
          SELECT name, pin FROM pump_configs WHERE id = ${pumpId}
        `;
        if (pumpRecords.length === 0) continue;
        const pump = pumpRecords[0];

        if (willRain) {
          // Weather skip logged
          await sql`
            INSERT INTO command_logs (pump, pump_name, pump_pin, state, status, error_details, start_volume_liters)
            VALUES (${pumpId}, ${pump.name}, ${pump.pin}, 1, 'skipped', ${`Weather skip active: ${rainReason}`}, ${currentVolume})
          `;
          triggersRun.push({ pumpId, pumpName: pump.name, status: 'skipped', reason: rainReason });
          continue;
        }

        if (willSkipMoisture) {
          // Moisture skip logged
          await sql`
            INSERT INTO command_logs (pump, pump_name, pump_pin, state, status, error_details, start_volume_liters)
            VALUES (${pumpId}, ${pump.name}, ${pump.pin}, 1, 'skipped', ${`Moisture skip active: ${skipReasonMoisture}`}, ${currentVolume})
          `;
          triggersRun.push({ pumpId, pumpName: pump.name, status: 'skipped', reason: skipReasonMoisture });
          continue;
        }

        const minVol = configMap['reservoir_min_volume_liters'] ? parseFloat(configMap['reservoir_min_volume_liters']) : 5.0;
        if (currentVolume !== null && currentVolume < minVol) {
          // Reservoir empty safety skip logged
          await sql`
            INSERT INTO command_logs (pump, pump_name, pump_pin, state, status, error_details, start_volume_liters)
            VALUES (${pumpId}, ${pump.name}, ${pump.pin}, 1, 'skipped', ${`Safety Lockout: Reservoir is too low (${currentVolume}L, limit: ${minVol}L).`}, ${currentVolume})
          `;
          triggersRun.push({ pumpId, pumpName: pump.name, status: 'skipped', reason: `Low Reservoir Volume (${currentVolume}L)` });
          continue;
        }

        try {
          // Turn Pump ON via MQTT
          const msgId = await publishMqttCommand(apiUrl, apiKey, apiSecret, pumpId, 1);
          
          // Log ON event and record start volume & expected duration
          await sql`
            INSERT INTO command_logs (pump, pump_name, pump_pin, state, status, response_msg_id, duration_seconds, start_volume_liters)
            VALUES (${pumpId}, ${pump.name}, ${pump.pin}, 1, 'success', ${msgId}, ${sched.duration_seconds}, ${currentVolume})
          `;

          // Update pump active state
          await sql`
            UPDATE pump_configs
            SET state = 1
            WHERE id = ${pumpId}
          `;

          triggersRun.push({ pumpId, pumpName: pump.name, status: 'triggered_on', duration: sched.duration_seconds });
        } catch (err) {
          console.error(`Failed to trigger pump ON for schedule run:`, err.message);
          await sql`
            INSERT INTO command_logs (pump, pump_name, pump_pin, state, status, error_details)
            VALUES (${pumpId}, ${pump.name}, ${pump.pin}, 1, 'failed', ${err.message})
          `;
          triggersRun.push({ pumpId, pumpName: pump.name, status: 'failed', error: err.message });
        }
      }
    }

    // 5. Sweeper loop: Find and stop pumps whose active running durations have expired
    const activePumps = await sql`
      SELECT id, name, pin FROM pump_configs 
      WHERE state = 1
    `;

    for (const pump of activePumps) {
      // Find latest success ON log that has a target duration
      const lastOnLog = await sql`
        SELECT id, duration_seconds, created_at FROM command_logs
        WHERE pump = ${pump.id} AND state = 1 AND status = 'success' AND duration_seconds IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
      `;

      if (lastOnLog.length > 0) {
        const onLog = lastOnLog[0];
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(onLog.created_at).getTime()) / 1000));
        
        if (elapsedSeconds >= onLog.duration_seconds) {
          console.log(`Pump ${pump.name} has run for ${elapsedSeconds}s (Target: ${onLog.duration_seconds}s). Sweeping OFF.`);
          try {
            // Turn Pump OFF via MQTT
            const msgId = await publishMqttCommand(apiUrl, apiKey, apiSecret, pump.id, 0);

            // Log OFF event and duration (defer water_used_liters to telemetry ingest)
            await sql`
              INSERT INTO command_logs (pump, pump_name, pump_pin, state, status, response_msg_id, duration_seconds)
              VALUES (${pump.id}, ${pump.name}, ${pump.pin}, 0, 'success', ${msgId}, ${elapsedSeconds})
            `;

            // Reset pump state to 0
            await sql`
              UPDATE pump_configs
              SET state = 0
              WHERE id = ${pump.id}
            `;

            sweepsRun.push({ pumpId: pump.id, pumpName: pump.name, status: 'swept_off', elapsed: elapsedSeconds });
          } catch (err) {
            console.error(`Failed to sweep pump OFF:`, err.message);
            await sql`
              INSERT INTO command_logs (pump, pump_name, pump_pin, state, status, error_details)
              VALUES (${pump.id}, ${pump.name}, ${pump.pin}, 0, 'failed', ${err.message})
            `;
            sweepsRun.push({ pumpId: pump.id, pumpName: pump.name, status: 'failed', error: err.message });
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: now.toISOString(),
      local_time: `${localDateStr} ${localTimeStr}`,
      triggers: triggersRun,
      sweeps: sweepsRun
    });
  } catch (error) {
    console.error('Cron routine processing failed:', error);
    return NextResponse.json(
      { success: false, error: 'Internal cron execution failure.', details: error.message },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
