import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// GET: List all active/inactive schedules
export async function GET() {
  try {
    const sql = getDb();
    const [schedules, pumps, flows] = await Promise.all([
      sql`
        SELECT * FROM watering_schedules
        ORDER BY time_of_day ASC, id ASC
      `,
      sql`
        SELECT id, name, pin FROM pump_configs
      `,
      sql`
        SELECT id, name FROM watering_flows
      `
    ]);

    const pumpMap = {};
    pumps.forEach(p => {
      pumpMap[p.id] = { name: p.name, pin: p.pin };
    });

    const flowMap = {};
    flows.forEach(f => {
      flowMap[f.id] = { name: f.name };
    });

    const formattedSchedules = schedules.map(s => {
      const targetPumps = (s.pump_ids || []).map(id => ({
        id,
        name: pumpMap[id]?.name || `Pump ${id}`,
        pin: pumpMap[id]?.pin || 0
      }));
      const targetFlows = (s.flow_ids || []).map(id => ({
        id,
        name: flowMap[id]?.name || `Flow ${id}`
      }));
      return {
        ...s,
        pumps: targetPumps,
        pump_name: targetPumps.map(p => p.name).join(', '),
        pump_pin: targetPumps.map(p => p.pin).join(', '),
        flows: targetFlows,
        flow_name: targetFlows.map(f => f.name).join(', '),
        // Fallback for older code referencing single pump_id
        pump_id: s.pump_ids && s.pump_ids.length > 0 ? s.pump_ids[0] : null
      };
    });

    return NextResponse.json({ success: true, schedules: formattedSchedules });
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
    const { id, pump_id, pump_ids, flow_ids, time_of_day, duration_seconds, days_of_week, enabled, cycles, soak_duration_seconds } = payload || {};

    if ((pump_id === undefined && !Array.isArray(pump_ids) && !Array.isArray(flow_ids)) || !time_of_day || duration_seconds === undefined || !Array.isArray(days_of_week)) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters. flow_ids, time_of_day, duration_seconds, and days_of_week are required.' },
        { status: 400 }
      );
    }

    const parsedDuration = parseInt(duration_seconds, 10);
    const isEnabled = enabled !== false; // default true
    const parsedCycles = parseInt(cycles, 10) || 1;
    const parsedSoak = parseInt(soak_duration_seconds, 10) || 0;

    if (isNaN(parsedDuration) || parsedDuration <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid duration_seconds.' },
        { status: 400 }
      );
    }

    // Parse flow_ids array
    let targetFlowIds = [];
    if (Array.isArray(flow_ids)) {
      targetFlowIds = flow_ids.map(d => parseInt(d, 10)).filter(d => !isNaN(d));
    }

    // Parse pump_ids array (backward compatibility)
    let targetPumpIds = [];
    if (Array.isArray(pump_ids)) {
      targetPumpIds = pump_ids.map(d => parseInt(d, 10)).filter(d => !isNaN(d));
    } else if (pump_id !== undefined) {
      targetPumpIds = [parseInt(pump_id, 10)].filter(d => !isNaN(d));
    }

    if (targetFlowIds.length === 0 && targetPumpIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one valid flow or pump must be selected.' },
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

    // Verify all flows exist (if provided)
    if (targetFlowIds.length > 0) {
      const flowRecords = await sql`
        SELECT id FROM watering_flows WHERE id = ANY(${targetFlowIds}::int[])
      `;
      if (flowRecords.length !== targetFlowIds.length) {
        return NextResponse.json(
          { success: false, error: 'One or more selected watering flows do not exist.' },
          { status: 400 }
        );
      }
    }

    // Verify all pumps exist (if provided)
    if (targetPumpIds.length > 0) {
      const pumpRecords = await sql`
        SELECT id FROM pump_configs WHERE id = ANY(${targetPumpIds}::int[])
      `;
      if (pumpRecords.length !== targetPumpIds.length) {
        return NextResponse.json(
          { success: false, error: 'One or more selected pumps do not exist.' },
          { status: 400 }
        );
      }
    }

    if (id) {
      // Update existing schedule
      await sql`
        UPDATE watering_schedules
        SET 
          pump_ids = ${targetPumpIds.length > 0 ? targetPumpIds : null}::int[],
          flow_ids = ${targetFlowIds.length > 0 ? targetFlowIds : null}::int[],
          time_of_day = ${time_of_day},
          duration_seconds = ${parsedDuration},
          days_of_week = ${validDays}::int[],
          enabled = ${isEnabled},
          cycles = ${parsedCycles},
          soak_duration_seconds = ${parsedSoak}
        WHERE id = ${parseInt(id, 10)}
      `;
      return NextResponse.json({ success: true, message: 'Watering schedule updated successfully.' });
    } else {
      // Create new schedule
      await sql`
        INSERT INTO watering_schedules (pump_ids, flow_ids, time_of_day, duration_seconds, days_of_week, enabled, cycles, soak_duration_seconds)
        VALUES (
          ${targetPumpIds.length > 0 ? targetPumpIds : null}::int[], 
          ${targetFlowIds.length > 0 ? targetFlowIds : null}::int[], 
          ${time_of_day}, 
          ${parsedDuration}, 
          ${validDays}::int[], 
          ${isEnabled},
          ${parsedCycles},
          ${parsedSoak}
        )
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
