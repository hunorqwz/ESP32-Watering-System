import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const sql = getDb();

    // Fetch all dashboard datasets concurrently to minimize response latency
    const [latestLogs, historicalLogs, commands, configs] = await Promise.all([
      // 1. Fetch the latest telemetry log
      sql`
        SELECT * FROM sensor_logs 
        ORDER BY created_at DESC 
        LIMIT 1
      `,
      // 2. Fetch the last 20 logs for historical charts (ordered chronologically for rendering)
      sql`
        SELECT * FROM (
          SELECT * FROM sensor_logs 
          ORDER BY created_at DESC 
          LIMIT 20
        ) sub
        ORDER BY created_at ASC
      `,
      // 3. Fetch the last 10 control command executions
      sql`
        SELECT * FROM command_logs 
        ORDER BY created_at DESC 
        LIMIT 10
      `,
      // 4. Fetch all configuration settings
      sql`
        SELECT key, value FROM system_config
      `
    ]);

    const currentStatus = latestLogs.length > 0 ? latestLogs[0] : null;
    
    // Map configurations array to key-value object
    const configMap = {};
    configs.forEach(cfg => {
      configMap[cfg.key] = cfg.value;
    });
    
    const intervalMinutes = configMap['telemetry_interval_minutes'] 
      ? parseInt(configMap['telemetry_interval_minutes'], 10) 
      : 15;
    
    let deviceStatus = {
      active: false,
      last_seen_seconds: null,
      interval_minutes: intervalMinutes
    };

    if (currentStatus) {
      const lastLogTime = new Date(currentStatus.created_at).getTime();
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - lastLogTime) / 1000));
      const thresholdSeconds = (intervalMinutes + 2) * 60; // 15m interval + 2m buffer
      
      deviceStatus = {
        active: elapsedSeconds <= thresholdSeconds,
        last_seen_seconds: elapsedSeconds,
        interval_minutes: intervalMinutes
      };
    }

    return NextResponse.json({
      success: true,
      current: currentStatus,
      history: historicalLogs,
      commands: commands,
      device_status: deviceStatus,
      configs: configMap
    });
  } catch (error) {
    console.error('Failed to load dashboard data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve data from database.', details: error.message },
      { status: 500 }
    );
  }
}
export const dynamic = 'force-dynamic';
