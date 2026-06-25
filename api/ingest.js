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

  // Validate that required fields are valid numbers
  if (
    isNaN(Number(m1)) ||
    isNaN(Number(m2)) ||
    isNaN(Number(m3)) ||
    isNaN(Number(m4)) ||
    isNaN(Number(m5))
  ) {
    return response.status(400).json({
      success: false,
      error: 'Telemetry values m1, m2, m3, m4, and m5 must be valid numbers.'
    });
  }

  // Validate optional numeric fields
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
        ${Number(m1)}, 
        ${Number(m2)}, 
        ${Number(m3)}, 
        ${Number(m4)}, 
        ${Number(m5)}, 
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
