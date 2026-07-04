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

    // Fetch WiFi settings, interval, sensor configurations, and pump configurations
    const [configs, sensors, pumps] = await Promise.all([
      sql`
        SELECT key, value FROM system_config 
        WHERE key IN ('wifi_ssid', 'wifi_password', 'telemetry_interval_minutes')
      `,
      sql`
        SELECT id, name, type, pin, pin_secondary, dry_limit, wet_limit FROM sensor_configs 
        ORDER BY id ASC
      `,
      sql`
        SELECT id, name, pin, state FROM pump_configs 
        ORDER BY id ASC
      `
    ]);

    // Parse system configs into key-value map
    const configMap = {};
    configs.forEach(cfg => {
      configMap[cfg.key] = cfg.value;
    });

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
      sensors: sensors,
      pumps: pumps
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
