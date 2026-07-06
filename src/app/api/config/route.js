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
    const { key, value } = payload || {};

    if (!key || value === undefined) {
      return NextResponse.json(
        { success: false, error: 'Missing parameters. "key" and "value" are required.' },
        { status: 400 }
      );
    }

    // Limit keys to prevent injection or arbitrary inserts
    const allowedKeys = [
      'telemetry_interval_minutes',
      'wifi_ssid',
      'wifi_password',
      'reservoir_use_dimensions',
      'reservoir_total_volume_liters',
      'reservoir_width_cm',
      'reservoir_length_cm',
      'reservoir_height_cm',
      'reservoir_sensor_offset_cm',
      'latitude',
      'longitude',
      'location_name',
      'timezone',
      'moisture_skip_threshold_percent',
      'reservoir_min_volume_liters'
    ];
    if (!allowedKeys.includes(key)) {
      return NextResponse.json(
        { success: false, error: `Invalid configuration key: "${key}".` },
        { status: 400 }
      );
    }

    const sql = getDb();
    let valueToStore = String(value);

    if (key === 'wifi_password') {
      const { encrypt } = await import('@/lib/crypto');
      valueToStore = encrypt(valueToStore);
    }

    // Update the config key
    await sql`
      INSERT INTO system_config (key, value, updated_at)
      VALUES (${key}, ${valueToStore}, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO 
      UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
    `;

    // Clear weather forecast cache if location settings change
    if (key === 'latitude' || key === 'longitude' || key === 'location_name') {
      try {
        await sql`DELETE FROM weather_forecast_cache`;
        console.log(`Cleared weather forecast cache due to location config update: ${key}`);
      } catch (cacheErr) {
        console.error('Failed to clear weather cache on location config update:', cacheErr);
      }
    }

    // Auto-calibrate water_level sensor dry/wet limits if reservoir heights change
    if (key === 'reservoir_height_cm' || key === 'reservoir_sensor_offset_cm') {
      try {
        const configs = await sql`
          SELECT key, value FROM system_config
          WHERE key IN ('reservoir_height_cm', 'reservoir_sensor_offset_cm')
        `;
        const configMap = {};
        configs.forEach(c => {
          configMap[c.key] = c.value;
        });

        const height = configMap['reservoir_height_cm'] ? parseFloat(configMap['reservoir_height_cm']) : 50;
        const offset = configMap['reservoir_sensor_offset_cm'] ? parseFloat(configMap['reservoir_sensor_offset_cm']) : 100;

        if (!isNaN(height) && !isNaN(offset)) {
          const dryLimit = offset;
          const wetLimit = Math.max(0, offset - height);

          await sql`
            UPDATE sensor_configs
            SET dry_limit = ${dryLimit}, wet_limit = ${wetLimit}
            WHERE type = 'water_level'
          `;
          console.log(`Auto-calibrated water_level sensor limits: dry_limit = ${dryLimit}, wet_limit = ${wetLimit}`);
        }
      } catch (syncErr) {
        console.error('Failed to sync water_level sensor dry/wet limits:', syncErr);
      }
    }

    // Trigger immediate ESP32 config reload via MQTT for WiFi credential changes
    if (key === 'wifi_ssid' || key === 'wifi_password') {
      await triggerReload();
    }

    return NextResponse.json({
      success: true,
      message: `Configuration "${key}" updated successfully.`
    });
  } catch (error) {
    console.error('Failed to update system config:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update system config in database.', details: error.message },
      { status: 500 }
    );
  }
}
