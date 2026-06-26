import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(request) {
  // Check if DATABASE_URL is available
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is missing.');
    return NextResponse.json(
      { success: false, error: 'Database connection configuration is missing on the server.' },
      { status: 500 }
    );
  }

  // Extract payload from request body
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON payload.' },
      { status: 400 }
    );
  }

  const { deviceId, m1, m2, m3, m4, m5, temp, hum, waterLevel } = payload || {};

  // Validate required telemetry fields
  if (
    deviceId === undefined ||
    m1 === undefined ||
    m2 === undefined ||
    m3 === undefined ||
    m4 === undefined ||
    m5 === undefined
  ) {
    return NextResponse.json(
      { success: false, error: 'Missing required fields. deviceId, m1, m2, m3, m4, and m5 are mandatory.' },
      { status: 400 }
    );
  }

  // Parse and validate required numeric telemetry fields
  const numM1 = Number(m1);
  const numM2 = Number(m2);
  const numM3 = Number(m3);
  const numM4 = Number(m4);
  const numM5 = Number(m5);

  if (
    isNaN(numM1) ||
    isNaN(numM2) ||
    isNaN(numM3) ||
    isNaN(numM4) ||
    isNaN(numM5)
  ) {
    return NextResponse.json(
      { success: false, error: 'Telemetry values m1, m2, m3, m4, and m5 must be valid numbers.' },
      { status: 400 }
    );
  }

  // Parse and validate optional numeric fields
  const numTemp = temp !== undefined && temp !== null ? Number(temp) : null;
  const numHum = hum !== undefined && hum !== null ? Number(hum) : null;
  const numWaterLevel = waterLevel !== undefined && waterLevel !== null ? Number(waterLevel) : null;

  if (
    (numTemp !== null && isNaN(numTemp)) ||
    (numHum !== null && isNaN(numHum)) ||
    (numWaterLevel !== null && isNaN(numWaterLevel))
  ) {
    return NextResponse.json(
      { success: false, error: 'Optional telemetry values (temp, hum, waterLevel) must be valid numbers if provided.' },
      { status: 400 }
    );
  }

  try {
    // Get database client
    const sql = getDb();

    // Insert the sensor telemetry data into NeonDB
    await sql`
      INSERT INTO sensor_logs (
        device_id, 
        m1, 
        m2, 
        m3, 
        m4, 
        m5, 
        temp, 
        hum, 
        water_level
      ) VALUES (
        ${deviceId}, 
        ${numM1}, 
        ${numM2}, 
        ${numM3}, 
        ${numM4}, 
        ${numM5}, 
        ${numTemp}, 
        ${numHum}, 
        ${numWaterLevel}
      )
    `;

    // Fetch current telemetry configuration to return on-wake
    const configs = await sql`
      SELECT value FROM system_config 
      WHERE key = 'telemetry_interval_minutes'
    `;
    const intervalMinutes = configs.length > 0 ? parseInt(configs[0].value, 10) : 15;

    return NextResponse.json(
      { 
        success: true, 
        message: 'Telemetry data successfully recorded.',
        telemetry_interval_minutes: intervalMinutes
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Database insertion error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to write telemetry data to the database.', details: error.message },
      { status: 500 }
    );
  }
}
