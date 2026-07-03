import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const sql = getDb();

    // Fetch all metadata configs, latest values, commands, and system configs concurrently
    const [sensors, pumps, latestReadings, commands, configs] = await Promise.all([
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
      `
    ]);

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
      configs: configMap
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
