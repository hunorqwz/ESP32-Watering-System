import { neon } from '@neondatabase/serverless';

export default async function handler(request, response) {
  // Ensure we only process POST requests
  if (request.method !== 'POST') {
    response.setHeader('Allow', ['POST']);
    return response.status(405).json({
      success: false,
      error: `Method ${request.method} Not Allowed. Use POST.`
    });
  }

  // Check if DATABASE_URL is available
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is missing.');
    return response.status(500).json({
      success: false,
      error: 'Database connection configuration is missing on the server.'
    });
  }

  // Extract payload from request body (parsing if it is sent as a raw string)
  let payload = request.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      return response.status(400).json({
        success: false,
        error: 'Invalid JSON payload.'
      });
    }
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
    return response.status(400).json({
      success: false,
      error: 'Missing required fields. deviceId, m1, m2, m3, m4, and m5 are mandatory.'
    });
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
    return response.status(400).json({
      success: false,
      error: 'Telemetry values m1, m2, m3, m4, and m5 must be valid numbers.'
    });
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
    return response.status(400).json({
      success: false,
      error: 'Optional telemetry values (temp, hum, waterLevel) must be valid numbers if provided.'
    });
  }

  try {
    // Initialize the Neon SQL client
    const sql = neon(databaseUrl);

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

    return response.status(201).json({
      success: true,
      message: 'Telemetry data successfully recorded.'
    });
  } catch (error) {
    console.error('Database insertion error:', error);
    return response.status(500).json({
      success: false,
      error: 'Failed to write telemetry data to the database.',
      details: error.message
    });
  }
}
