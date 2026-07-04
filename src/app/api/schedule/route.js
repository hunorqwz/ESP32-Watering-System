import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// GET: List all active/inactive schedules
export async function GET() {
  try {
    const sql = getDb();
    const schedules = await sql`
      SELECT s.*, p.name as pump_name, p.pin as pump_pin 
      FROM watering_schedules s
      JOIN pump_configs p ON s.pump_id = p.id
      ORDER BY s.time_of_day ASC, s.id ASC
    `;
    return NextResponse.json({ success: true, schedules });
  } catch (err) {
    console.error('Failed to retrieve schedules:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve schedules from database.', details: err.message },
      { status: 500 }
    );
  }
}

// POST: Create or Update schedule
export async function POST(request) {
  try {
    const payload = await request.json();
    const { id, pump_id, time_of_day, duration_seconds, days_of_week, enabled } = payload || {};

    if (pump_id === undefined || !time_of_day || duration_seconds === undefined || !Array.isArray(days_of_week)) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters. pump_id, time_of_day, duration_seconds, and days_of_week are required.' },
        { status: 400 }
      );
    }

    const parsedPumpId = parseInt(pump_id, 10);
    const parsedDuration = parseInt(duration_seconds, 10);
    const isEnabled = enabled !== false; // default true

    if (isNaN(parsedPumpId) || isNaN(parsedDuration) || parsedDuration <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid pump_id or duration_seconds.' },
        { status: 400 }
      );
    }

    // Validate days_of_week integers 1 to 7
    const validDays = days_of_week.map(d => parseInt(d, 10)).filter(d => !isNaN(d) && d >= 1 && d <= 7);
    if (validDays.length === 0) {
      return NextResponse.json(
        { success: false, error: 'days_of_week must contain integers from 1 (Monday) to 7 (Sunday).' },
        { status: 400 }
      );
    }

    // Validate time_of_day HH:MM format
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;
    if (!timeRegex.test(time_of_day)) {
      return NextResponse.json(
        { success: false, error: 'time_of_day must be in valid 24h HH:MM format.' },
        { status: 400 }
      );
    }

    const sql = getDb();

    // Verify pump exists
    const pumpRecord = await sql`
      SELECT id FROM pump_configs WHERE id = ${parsedPumpId}
    `;
    if (pumpRecord.length === 0) {
      return NextResponse.json(
        { success: false, error: `Pump ID ${parsedPumpId} does not exist.` },
        { status: 400 }
      );
    }

    if (id) {
      // Update existing schedule
      await sql`
        UPDATE watering_schedules
        SET 
          pump_id = ${parsedPumpId},
          time_of_day = ${time_of_day},
          duration_seconds = ${parsedDuration},
          days_of_week = ${validDays}::int[],
          enabled = ${isEnabled}
        WHERE id = ${parseInt(id, 10)}
      `;
      return NextResponse.json({ success: true, message: 'Watering schedule updated successfully.' });
    } else {
      // Create new schedule
      await sql`
        INSERT INTO watering_schedules (pump_id, time_of_day, duration_seconds, days_of_week, enabled)
        VALUES (${parsedPumpId}, ${time_of_day}, ${parsedDuration}, ${validDays}::int[], ${isEnabled})
      `;
      return NextResponse.json({ success: true, message: 'Watering schedule created successfully.' });
    }
  } catch (err) {
    console.error('Failed to save schedule:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to write schedule configuration.', details: err.message },
      { status: 500 }
    );
  }
}

// DELETE: Delete a schedule
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
      DELETE FROM watering_schedules 
      WHERE id = ${parseInt(id, 10)}
    `;
    return NextResponse.json({ success: true, message: 'Watering schedule deleted successfully.' });
  } catch (err) {
    console.error('Failed to delete schedule:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to delete schedule config.', details: err.message },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
