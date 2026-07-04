import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

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
      'location_name'
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
