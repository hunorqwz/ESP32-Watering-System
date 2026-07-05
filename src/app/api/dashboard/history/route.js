import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || '7d';
    
    let days = 7;
    if (range === '30d') days = 30;
    else if (range === '24h') days = 1;

    const sql = getDb();

    // 1. Fetch moisture sensor metadata to handle percentage conversions and name mapping
    const moistureSensors = await sql`
      SELECT id, name, dry_limit, wet_limit FROM sensor_configs 
      WHERE type = 'moisture'
    `;
    const sensorMap = {};
    moistureSensors.forEach(s => {
      sensorMap[s.id] = {
        name: s.name,
        dry: s.dry_limit ?? 3400,
        wet: s.wet_limit ?? 1100
      };
    });

    // 2. Fetch moisture readings grouped by time buckets
    // Grouping by hour for 7d/30d, or 10 minutes for 24h
    let timeSeriesRows = [];
    if (moistureSensors.length > 0) {
      if (range === '24h') {
        timeSeriesRows = await sql`
          SELECT 
            sensor_config_id,
            AVG(value) as avg_value,
            date_trunc('minute', created_at) - (CAST(extract(minute FROM created_at) AS integer) % 10) * INTERVAL '1 minute' as time_bucket
          FROM sensor_readings
          WHERE created_at > NOW() - INTERVAL '24 hours'
            AND sensor_config_id = ANY(${moistureSensors.map(s => s.id)}::int[])
          GROUP BY sensor_config_id, time_bucket
          ORDER BY time_bucket ASC
        `;
      } else {
        timeSeriesRows = await sql`
          SELECT 
            sensor_config_id,
            AVG(value) as avg_value,
            date_trunc('hour', created_at) as time_bucket
          FROM sensor_readings
          WHERE created_at > NOW() - CAST(${days} || ' days' AS interval)
            AND sensor_config_id = ANY(${moistureSensors.map(s => s.id)}::int[])
          GROUP BY sensor_config_id, time_bucket
          ORDER BY time_bucket ASC
        `;
      }
    }

    // 3. Process time-series readings into Recharts-friendly JSON
    const timeBucketMap = {};
    timeSeriesRows.forEach(row => {
      const bucketStr = new Date(row.time_bucket).toISOString();
      const sensor = sensorMap[row.sensor_config_id];
      if (!sensor) return;

      const raw = parseFloat(row.avg_value);
      const dry = sensor.dry;
      const wet = sensor.wet;
      let pct = 0;
      if (dry !== wet) {
        if (dry > wet) {
          pct = raw >= dry ? 0 : raw <= wet ? 100 : Math.round(((dry - raw) / (dry - wet)) * 100);
        } else {
          pct = raw <= dry ? 0 : raw >= wet ? 100 : Math.round(((raw - dry) / (wet - dry)) * 100);
        }
      }

      if (!timeBucketMap[bucketStr]) {
        timeBucketMap[bucketStr] = {
          time: new Date(row.time_bucket).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: range === '24h' ? '2-digit' : undefined,
            hour12: false
          })
        };
      }
      timeBucketMap[bucketStr][sensor.name] = pct;
    });

    const moistureHistory = Object.keys(timeBucketMap)
      .sort((a, b) => new Date(a) - new Date(b))
      .map(key => timeBucketMap[key]);

    // 4. Fetch daily pump water usage totals
    const waterUsageRows = await sql`
      SELECT 
        pump,
        pump_name,
        SUM(water_used_liters) as total_water,
        date_trunc('day', created_at) as date_bucket
      FROM command_logs
      WHERE created_at > NOW() - CAST(${days} || ' days' AS interval)
        AND state = 0
        AND status = 'success'
        AND water_used_liters IS NOT NULL
      GROUP BY pump, pump_name, date_bucket
      ORDER BY date_bucket ASC
    `;

    // Process water usage into daily Recharts format
    const dailyWaterMap = {};
    waterUsageRows.forEach(row => {
      const dateStr = new Date(row.date_bucket).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });
      const pumpName = row.pump_name || `Pump ${row.pump}`;
      
      if (!dailyWaterMap[dateStr]) {
        dailyWaterMap[dateStr] = { date: dateStr };
      }
      dailyWaterMap[dateStr][pumpName] = Math.round(parseFloat(row.total_water) * 10) / 10;
    });

    const waterHistory = Object.keys(dailyWaterMap).map(key => dailyWaterMap[key]);

    // 5. Gather skip analytics (total runs skipped and reasons)
    const skippedLogs = await sql`
      SELECT error_details, count(*) as count
      FROM command_logs
      WHERE created_at > NOW() - CAST(${days} || ' days' AS interval)
        AND status = 'skipped'
      GROUP BY error_details
    `;

    let totalSkipped = 0;
    let rainSkips = 0;
    let moistureSkips = 0;
    let safeguardSkips = 0;

    skippedLogs.forEach(log => {
      const cnt = parseInt(log.count, 10);
      totalSkipped += cnt;
      if (log.error_details?.toLowerCase().includes('weather') || log.error_details?.toLowerCase().includes('rain')) {
        rainSkips += cnt;
      } else if (log.error_details?.toLowerCase().includes('moisture')) {
        moistureSkips += cnt;
      } else if (log.error_details?.toLowerCase().includes('reservoir') || log.error_details?.toLowerCase().includes('safety')) {
        safeguardSkips += cnt;
      }
    });

    return NextResponse.json({
      success: true,
      range,
      moistureHistory,
      waterHistory,
      analytics: {
        totalSkipped,
        rainSkips,
        moistureSkips,
        safeguardSkips
      }
    });
  } catch (err) {
    console.error('Failed to query historical telemetry:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve telemetry history.', details: err.message },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
