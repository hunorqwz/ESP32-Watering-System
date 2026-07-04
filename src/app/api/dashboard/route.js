import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Helper to prevent timezone shifting when converting database date objects to YYYY-MM-DD
function toLocalDateString(date) {
  if (!(date instanceof Date)) {
    return String(date).split('T')[0];
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function GET() {
  try {
    const sql = getDb();

    // Fetch all metadata configs, latest values, commands, and system configs concurrently
    const [sensors, pumps, latestReadings, commands, configs, rawSchedules, weatherCache] = await Promise.all([
      // 1. Fetch sensor configurations
      sql`
        SELECT * FROM sensor_configs 
        ORDER BY id ASC
      `,
      // 2. Fetch pump configurations
      sql`
        SELECT * FROM pump_configs 
        ORDER BY id ASC
      `,
      // 3. Fetch the single latest reading for each sensor config
      sql`
        SELECT DISTINCT ON (sensor_config_id) 
          sensor_config_id, value, created_at 
        FROM sensor_readings 
        ORDER BY sensor_config_id, created_at DESC
      `,
      // 4. Fetch the last 10 control command executions
      sql`
        SELECT * FROM command_logs 
        ORDER BY created_at DESC 
        LIMIT 10
      `,
      // 5. Fetch all system configurations
      sql`
        SELECT key, value FROM system_config
      `,
      // 6. Fetch all schedules
      sql`
        SELECT * FROM watering_schedules
        ORDER BY time_of_day ASC
      `,
      // 7. Fetch cached weather forecasts
      sql`
        SELECT * FROM weather_forecast_cache
        ORDER BY forecast_date ASC
      `
    ]);

    const pumpMap = {};
    pumps.forEach(p => {
      pumpMap[p.id] = { name: p.name, pin: p.pin };
    });

    const schedules = rawSchedules.map(s => {
      const targetPumps = (s.pump_ids || []).map(id => ({
        id,
        name: pumpMap[id]?.name || `Pump ${id}`,
        pin: pumpMap[id]?.pin || 0
      }));
      return {
        ...s,
        pumps: targetPumps,
        pump_name: targetPumps.map(p => p.name).join(', '),
        pump_pin: targetPumps.map(p => p.pin).join(', '),
        // Fallback for single pump fields
        pump_id: s.pump_ids && s.pump_ids.length > 0 ? s.pump_ids[0] : null
      };
    });

    // Map system configs into key-value map
    const configMap = {};
    configs.forEach(cfg => {
      configMap[cfg.key] = cfg.value;
    });

    if (configMap['wifi_password']) {
      configMap['wifi_password'] = '••••••••';
    }

    const intervalMinutes = configMap['telemetry_interval_minutes'] 
      ? parseInt(configMap['telemetry_interval_minutes'], 10) 
      : 15;

    // Map latest reading values by sensor ID for easy access
    const latestReadingsMap = {};
    let latestReportTime = null;

    latestReadings.forEach(r => {
      latestReadingsMap[r.sensor_config_id] = {
        value: r.value,
        created_at: r.created_at
      };

      const readingTime = new Date(r.created_at).getTime();
      if (!latestReportTime || readingTime > latestReportTime) {
        latestReportTime = readingTime;
      }
    });

    // Compute Next Watering Prediction
    let nextWatering = { time: 'None Scheduled', reason: 'No active schedules defined.', skipped: false, details: '' };
    const enabledSchedules = schedules.filter(s => s.enabled);
    
    if (enabledSchedules.length > 0) {
      let absoluteNextTime = null;
      let nextSchedule = null;
      
      const now = new Date();
      
      // Look forward up to 7 days
      for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
        const checkDate = new Date(now);
        checkDate.setDate(now.getDate() + dayOffset);
        
        // JS day of week (0 = Sunday, 1 = Monday ... 6 = Saturday)
        const jsDay = checkDate.getDay();
        const ourDay = jsDay === 0 ? 7 : jsDay;
        
        for (const sched of enabledSchedules) {
          if (!sched.days_of_week.includes(ourDay)) continue;
          
          const [hours, minutes, seconds] = sched.time_of_day.split(':').map(Number);
          const schedTime = new Date(checkDate);
          schedTime.setHours(hours, minutes, seconds || 0, 0);
          
          if (schedTime.getTime() > now.getTime()) {
            if (!absoluteNextTime || schedTime.getTime() < absoluteNextTime.getTime()) {
              absoluteNextTime = schedTime;
              nextSchedule = sched;
            }
          }
        }
        
        if (absoluteNextTime) break;
      }
      
      if (absoluteNextTime && nextSchedule) {
        const nextDateStr = toLocalDateString(absoluteNextTime);
        
        // Search if we have weather cache for this target date
        const forecastDay = weatherCache.find(w => {
          const wDateStr = toLocalDateString(w.forecast_date);
          return wDateStr === nextDateStr;
        });
        
        let willRain = false;
        let rainReason = '';
        
        if (forecastDay) {
          const prob = parseFloat(forecastDay.precipitation_probability);
          const mm = parseFloat(forecastDay.expected_precipitation_mm);
          
          // Heavy rain threshold: probability > 50% AND expected rain > 2mm
          if (prob > 0.50 && mm >= 2.0) {
            willRain = true;
            rainReason = `Heavy rain expected (${Math.round(prob * 100)}% chance, ${mm}mm).`;
          }
        }
        
        // Check latest soil moisture if moisture sensors exist
        let moistureSummary = '';
        const moistureSensors = sensors.filter(s => s.type === 'moisture');
        if (moistureSensors.length > 0) {
          let totalMoisture = 0;
          let count = 0;
          moistureSensors.forEach(s => {
            const reading = latestReadingsMap[s.id];
            if (reading) {
              const raw = reading.value;
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
            const avgMoisture = Math.round(totalMoisture / count);
            moistureSummary = `Average moisture: ${avgMoisture}%.`;
          }
        }
        
        const dateOptions = { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false };
        const timeLabel = absoluteNextTime.toLocaleDateString(undefined, dateOptions);
        
        nextWatering = {
          time: timeLabel,
          timestamp: absoluteNextTime.getTime(),
          pump_id: nextSchedule.pump_id,
          pump_name: nextSchedule.pump_name,
          duration_seconds: nextSchedule.duration_seconds,
          skipped: willRain,
          reason: willRain 
            ? `Skip active: ${rainReason}` 
            : `Scheduled cycle. ${moistureSummary}`,
          details: `Runs for ${nextSchedule.duration_seconds}s.`
        };
      }
    }

    // Calculate device active status
    let deviceStatus = {
      active: false,
      last_seen_seconds: null,
      interval_minutes: intervalMinutes
    };

    if (latestReportTime) {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - latestReportTime) / 1000));
      const thresholdSeconds = (intervalMinutes + 2) * 60; // interval + 2m buffer
      
      deviceStatus = {
        active: elapsedSeconds <= thresholdSeconds,
        last_seen_seconds: elapsedSeconds,
        interval_minutes: intervalMinutes
      };
    }

    return NextResponse.json({
      success: true,
      sensors: sensors,
      pumps: pumps,
      latest_readings: latestReadingsMap,
      history_readings: [],
      commands: commands,
      device_status: deviceStatus,
      configs: configMap,
      schedules: schedules,
      weather_forecast: weatherCache.map(row => ({
        forecast_date: toLocalDateString(row.forecast_date),
        precipitation_probability: parseFloat(row.precipitation_probability),
        expected_precipitation_mm: parseFloat(row.expected_precipitation_mm),
        temp_c: row.raw_payload?.temp_c || 22.0,
        description: row.raw_payload?.description || 'Clear skies'
      })),
      next_watering: nextWatering
    });
  } catch (error) {
    console.error('Failed to load dynamic dashboard datasets:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve dashboard dataset from database.', details: error.message },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
