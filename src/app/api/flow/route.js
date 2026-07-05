import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// GET: List all watering flows
export async function GET() {
  try {
    const sql = getDb();
    
    // Fetch flows, pumps and sensors concurrently to assemble them with rich details
    const [flows, pumps, sensors] = await Promise.all([
      sql`SELECT * FROM watering_flows ORDER BY id ASC`,
      sql`SELECT id, name, pin FROM pump_configs`,
      sql`SELECT id, name, type FROM sensor_configs`
    ]);

    const pumpMap = {};
    pumps.forEach(p => {
      pumpMap[p.id] = p;
    });

    const sensorMap = {};
    sensors.forEach(s => {
      sensorMap[s.id] = s;
    });

    const enrichedFlows = flows.map(f => {
      const targetSensors = (f.sensor_ids || []).map(sid => sensorMap[sid]).filter(Boolean);
      return {
        ...f,
        pump_name: pumpMap[f.pump_id]?.name || `Pump ${f.pump_id}`,
        pump_pin: pumpMap[f.pump_id]?.pin || 0,
        sensors: targetSensors,
        sensor_names: targetSensors.map(s => s.name).join(', ')
      };
    });

    return NextResponse.json({ success: true, flows: enrichedFlows });
  } catch (err) {
    console.error('Failed to retrieve watering flows:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve flows from database.', details: err.message },
      { status: 500 }
    );
  }
}

// POST: Create or Update a watering flow
export async function POST(request) {
  try {
    const payload = await request.json();
    const { id, name, pump_id, sensor_ids } = payload || {};

    if (!name || !pump_id || !Array.isArray(sensor_ids) || sensor_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing parameters. "name", "pump_id", and "sensor_ids" array are required.' },
        { status: 400 }
      );
    }

    const parsedPumpId = parseInt(pump_id, 10);
    const parsedSensorIds = sensor_ids.map(sid => parseInt(sid, 10)).filter(sid => !isNaN(sid));

    if (isNaN(parsedPumpId) || parsedSensorIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid "pump_id" or empty "sensor_ids".' },
        { status: 400 }
      );
    }

    const sql = getDb();

    // Verify pump exists
    const pumpRecord = await sql`SELECT id FROM pump_configs WHERE id = ${parsedPumpId}`;
    if (pumpRecord.length === 0) {
      return NextResponse.json(
        { success: false, error: `Pump with ID ${parsedPumpId} does not exist.` },
        { status: 400 }
      );
    }

    // Verify all sensors exist and are moisture sensors
    const sensorRecords = await sql`
      SELECT id FROM sensor_configs 
      WHERE id = ANY(${parsedSensorIds}::int[]) AND type = 'moisture'
    `;
    if (sensorRecords.length !== parsedSensorIds.length) {
      return NextResponse.json(
        { success: false, error: 'One or more selected sensors do not exist or are not soil moisture sensors.' },
        { status: 400 }
      );
    }

    if (id) {
      // Update existing flow
      const flowId = parseInt(id, 10);
      await sql`
        UPDATE watering_flows
        SET 
          name = ${name},
          pump_id = ${parsedPumpId},
          sensor_ids = ${parsedSensorIds}::int[]
        WHERE id = ${flowId}
      `;
      return NextResponse.json({ success: true, message: 'Watering flow updated successfully.' });
    } else {
      // Create new flow
      await sql`
        INSERT INTO watering_flows (name, pump_id, sensor_ids)
        VALUES (${name}, ${parsedPumpId}, ${parsedSensorIds}::int[])
      `;
      return NextResponse.json({ success: true, message: 'Watering flow created successfully.' });
    }
  } catch (err) {
    console.error('Failed to save watering flow:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to write flow config to database.', details: err.message },
      { status: 500 }
    );
  }
}

// DELETE: Remove a watering flow
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Missing parameter: "id" is required.' },
        { status: 400 }
      );
    }

    const flowId = parseInt(id, 10);
    const sql = getDb();

    await sql`DELETE FROM watering_flows WHERE id = ${flowId}`;
    return NextResponse.json({ success: true, message: 'Watering flow deleted successfully.' });
  } catch (err) {
    console.error('Failed to delete watering flow:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to delete flow from database.', details: err.message },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
