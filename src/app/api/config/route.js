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
    const allowedKeys = ['telemetry_interval_minutes'];
    if (!allowedKeys.includes(key)) {
      return NextResponse.json(
        { success: false, error: `Invalid configuration key: "${key}".` },
        { status: 400 }
      );
    }

    const sql = getDb();

    // Update the config key
    await sql`
      INSERT INTO system_config (key, value, updated_at)
      VALUES (${key}, ${String(value)}, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO 
      UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
    `;

    return NextResponse.json({
      success: true,
      message: `Configuration "${key}" updated successfully to "${value}".`
    });
  } catch (error) {
    console.error('Failed to update system config:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update system config in database.', details: error.message },
      { status: 500 }
    );
  }
}
