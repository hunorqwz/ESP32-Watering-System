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
      'sensor_m1_dry', 'sensor_m1_wet',
      'sensor_m2_dry', 'sensor_m2_wet',
      'sensor_m3_dry', 'sensor_m3_wet',
      'sensor_m4_dry', 'sensor_m4_wet',
      'sensor_m5_dry', 'sensor_m5_wet',
      'reservoir_empty_distance_cm',
      'reservoir_full_distance_cm',
      'reservoir_use_dimensions',
      'reservoir_total_volume_liters',
      'reservoir_width_cm',
      'reservoir_length_cm'
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
