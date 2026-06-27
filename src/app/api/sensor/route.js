import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Create or Update Sensor
export async function POST(request) {
  try {
    const payload = await request.json();
    const { id, name, type, pin, sensor_group, dry_limit, wet_limit } = payload || {};

    if (!name || !type || pin === undefined || !sensor_group) {
      return NextResponse.json(
        { success: false, error: 'Missing parameters. name, type, pin, and sensor_group are required.' },
        { status: 400 }
      );
    }

    const sql = getDb();
    const parsedPin = parseInt(pin, 10);
    if (isNaN(parsedPin)) {
      return NextResponse.json(
        { success: false, error: 'Invalid pin assignment. Pin must be a valid integer.' },
        { status: 400 }
      );
    }

    const dryVal = dry_limit !== undefined && dry_limit !== null && String(dry_limit).trim() !== '' ? parseInt(dry_limit, 10) : null;
    const wetVal = wet_limit !== undefined && wet_limit !== null && String(wet_limit).trim() !== '' ? parseInt(wet_limit, 10) : null;
    const dry = isNaN(dryVal) ? null : dryVal;
    const wet = isNaN(wetVal) ? null : wetVal;

    if (id) {
      // Update existing sensor config
      await sql`
        UPDATE sensor_configs 
        SET name = ${name}, type = ${type}, pin = ${parsedPin}, sensor_group = ${sensor_group}, dry_limit = ${dry}, wet_limit = ${wet}
        WHERE id = ${parseInt(id, 10)}
      `;
      return NextResponse.json({ success: true, message: 'Sensor configuration updated successfully.' });
    } else {
      // Insert new sensor config
      await sql`
        INSERT INTO sensor_configs (name, type, pin, sensor_group, dry_limit, wet_limit)
        VALUES (${name}, ${type}, ${parsedPin}, ${sensor_group}, ${dry}, ${wet})
      `;
      return NextResponse.json({ success: true, message: 'Sensor added successfully.' });
    }
  } catch (error) {
    console.error('Failed to save sensor configuration:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to write sensor configuration.', details: error.message },
      { status: 500 }
    );
  }
}

// Delete Sensor
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

    const sql = getDb();
    await sql`
      DELETE FROM sensor_configs 
      WHERE id = ${parseInt(id, 10)}
    `;

    return NextResponse.json({ success: true, message: 'Sensor configuration deleted successfully.' });
  } catch (error) {
    console.error('Failed to delete sensor configuration:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete sensor config.', details: error.message },
      { status: 500 }
    );
  }
}
