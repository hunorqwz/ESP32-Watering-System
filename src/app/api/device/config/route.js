import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  // Validate API Access Token
  const authHeader = request.headers.get('Authorization');
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const secretToken = process.env.API_ACCESS_TOKEN;

  if (!secretToken || token !== secretToken) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: Invalid or missing access token.' },
      { status: 401 }
    );
  }

  try {
    const sql = getDb();

    // Auto-update wifi_ssid in database if reported by device via HTTP header
    const deviceSsid = request.headers.get('X-Device-SSID');
    if (deviceSsid) {
      try {
        const currentConfig = await sql`
          SELECT value FROM system_config WHERE key = 'wifi_ssid' LIMIT 1
        `;
        const currentSsid = currentConfig.length > 0 ? currentConfig[0].value : '';
        if (currentSsid !== deviceSsid) {
          await sql`
            INSERT INTO system_config (key, value, updated_at)
            VALUES ('wifi_ssid', ${deviceSsid}, CURRENT_TIMESTAMP)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
          `;
          console.log(`Auto-updated wifi_ssid key to match online device: "${deviceSsid}"`);
        }
      } catch (dbErr) {
        console.error('Failed to auto-update wifi_ssid config:', dbErr.message);
      }
    }

    // Fetch WiFi settings, interval, sensor configurations, pump configurations, active schedules, and flows
    const [configs, sensors, pumps, schedules, flows] = await Promise.all([
      sql`
        SELECT key, value FROM system_config 
        WHERE key IN ('wifi_ssid', 'wifi_password', 'telemetry_interval_minutes', 'pump_safety_timeout_seconds', 'timezone')
      `,
      sql`
        SELECT id, name, type, pin, pin_secondary, dry_limit, wet_limit FROM sensor_configs 
        ORDER BY id ASC
      `,
      sql`
        SELECT id, name, pin, state FROM pump_configs 
        ORDER BY id ASC
      `,
      sql`
        SELECT id, pump_ids, flow_ids, time_of_day, duration_seconds, days_of_week, cycles, soak_duration_seconds FROM watering_schedules
        WHERE enabled = true
        ORDER BY id ASC
      `,
      sql`
        SELECT id, name, pump_id, sensor_ids FROM watering_flows
        ORDER BY id ASC
      `
    ]);

    // Parse system configs into key-value map
    const configMap = {};
    configs.forEach(cfg => {
      configMap[cfg.key] = cfg.value;
    });

    // Compute dynamic timezone offset in seconds to pass to ESP32 configTime NTP hook
    const tz = configMap['timezone'] || 'Europe/Bucharest';
    let tzOffsetSeconds = 7200; // default to GMT+2 (e.g. Europe/Bucharest winter time)
    try {
      const now = new Date();
      const dateStr = now.toLocaleString('en-US', { timeZone: tz });
      const tzDate = new Date(dateStr);
      const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
      tzOffsetSeconds = Math.round((tzDate.getTime() - utcDate.getTime()) / 1000);
    } catch (tzErr) {
      console.warn('Failed to calculate timezone offset:', tzErr.message);
    }

    if (configMap['wifi_password']) {
      const { decrypt } = await import('@/lib/crypto');
      configMap['wifi_password'] = decrypt(configMap['wifi_password']);
    }

    const responsePayload = {
      success: true,
      wifi_ssid: configMap['wifi_ssid'] || 'TerraceWiFi',
      wifi_password: configMap['wifi_password'] || '',
      telemetry_interval_minutes: configMap['telemetry_interval_minutes'] 
        ? parseInt(configMap['telemetry_interval_minutes'], 10) 
        : 15,
      pump_safety_timeout_seconds: configMap['pump_safety_timeout_seconds']
        ? parseInt(configMap['pump_safety_timeout_seconds'], 10)
        : 300,
      timezone_offset_seconds: tzOffsetSeconds,
      sensors: sensors,
      pumps: pumps,
      flows: flows,
      schedules: schedules
    };

    return NextResponse.json(responsePayload, { status: 200 });
  } catch (error) {
    console.error('Failed to retrieve device configuration:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve configuration from database.', details: error.message },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
