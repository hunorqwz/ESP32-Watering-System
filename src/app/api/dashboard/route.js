import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const sql = getDb();

    // 1. Fetch the latest telemetry log
    const latestLogs = await sql`
      SELECT * FROM sensor_logs 
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    const currentStatus = latestLogs.length > 0 ? latestLogs[0] : null;

    // 2. Fetch the last 20 logs for historical charts (ordered chronologically for rendering)
    const historicalLogs = await sql`
      SELECT * FROM (
        SELECT * FROM sensor_logs 
        ORDER BY created_at DESC 
        LIMIT 20
      ) sub
      ORDER BY created_at ASC
    `;

    // 3. Fetch the last 10 control command executions
    const commands = await sql`
      SELECT * FROM command_logs 
      ORDER BY created_at DESC 
      LIMIT 10
    `;

    // 4. Fetch the telemetry configuration and compute device connectivity status
    const configs = await sql`
      SELECT value FROM system_config 
      WHERE key = 'telemetry_interval_minutes'
    `;
    const intervalMinutes = configs.length > 0 ? parseInt(configs[0].value, 10) : 15;
    
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
      device_status: deviceStatus
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
