import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Create or Update Pump
export async function POST(request) {
  try {
    const payload = await request.json();
    const { id, name, pin } = payload || {};

    if (!name || pin === undefined) {
      return NextResponse.json(
        { success: false, error: 'Missing parameters. "name" and "pin" are required.' },
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

    if (id) {
      // Update existing pump config
      await sql`
        UPDATE pump_configs 
        SET name = ${name}, pin = ${parsedPin}
        WHERE id = ${parseInt(id, 10)}
      `;
      return NextResponse.json({ success: true, message: 'Pump configuration updated successfully.' });
    } else {
      // Insert new pump config
      await sql`
        INSERT INTO pump_configs (name, pin)
        VALUES (${name}, ${parsedPin})
      `;
      return NextResponse.json({ success: true, message: 'Pump added successfully.' });
    }
  } catch (error) {
    console.error('Failed to save pump configuration:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to write pump configuration.', details: error.message },
      { status: 500 }
    );
  }
}

// Delete Pump
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
      DELETE FROM pump_configs 
      WHERE id = ${parseInt(id, 10)}
    `;

    return NextResponse.json({ success: true, message: 'Pump configuration deleted successfully.' });
  } catch (error) {
    console.error('Failed to delete pump configuration:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete pump config.', details: error.message },
      { status: 500 }
    );
  }
}
