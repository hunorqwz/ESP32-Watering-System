import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { fetchLiveForecast, getMockForecast } from '@/lib/weather';

// Helper to prevent timezone shifting when converting database date objects to YYYY-MM-DD
function toLocalDateString(date) {
  if (!(date instanceof Date)) {
    return String(date).split('T')[0];
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function GET() {
  try {
    const sql = getDb();
    
    // Check if we have cached forecast data that is fresh (less than 2 hours old)
    const freshCache = await sql`
      SELECT * FROM weather_forecast_cache
      WHERE updated_at > NOW() - INTERVAL '2 hours'
      ORDER BY forecast_date ASC
    `;
    
    if (freshCache.length >= 3) {
      return NextResponse.json({
        success: true,
        source: 'cache',
        forecast: freshCache.map(row => ({
          forecast_date: toLocalDateString(row.forecast_date),
          precipitation_probability: parseFloat(row.precipitation_probability),
          expected_precipitation_mm: parseFloat(row.expected_precipitation_mm),
          temp_c: row.raw_payload?.temp_c || 22.0,
          description: row.raw_payload?.description || 'Clear skies'
        }))
      });
    }

    // Fetch coordinates from system config (Munich defaults)
    const latConfig = await sql`SELECT value FROM system_config WHERE key = 'latitude'`;
    const lngConfig = await sql`SELECT value FROM system_config WHERE key = 'longitude'`;
    const lat = latConfig.length > 0 ? latConfig[0].value : '48.137';
    const lng = lngConfig.length > 0 ? lngConfig[0].value : '11.575';

    let forecastData = [];
    try {
      forecastData = await fetchLiveForecast(lat, lng);
    } catch (apiErr) {
      console.error('Failed to fetch from Open-Meteo API, falling back to mock:', apiErr.message);
    }

    if (forecastData.length === 0) {
      forecastData = getMockForecast();
    }

    // Cache the forecast data into the database
    for (const day of forecastData) {
      await sql`
        INSERT INTO weather_forecast_cache (forecast_date, precipitation_probability, expected_precipitation_mm, raw_payload, updated_at)
        VALUES (
          ${day.forecast_date}::date, 
          ${day.precipitation_probability}, 
          ${day.expected_precipitation_mm}, 
          ${JSON.stringify({ temp_c: day.temp_c, description: day.description })}::jsonb,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (forecast_date) DO UPDATE
        SET 
          precipitation_probability = EXCLUDED.precipitation_probability,
          expected_precipitation_mm = EXCLUDED.expected_precipitation_mm,
          raw_payload = EXCLUDED.raw_payload,
          updated_at = CURRENT_TIMESTAMP
      `;
    }

    return NextResponse.json({
      success: true,
      source: 'live_resolved',
      forecast: forecastData
    });
  } catch (err) {
    console.error('Failed to resolve weather forecast:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve weather forecast.', details: err.message },
      { status: 500 }
    );
  }
}

// POST: Allows manual override/injection
export async function POST(request) {
  try {
    const payload = await request.json();
    const { forecast } = payload || {};

    if (!Array.isArray(forecast)) {
      return NextResponse.json(
        { success: false, error: 'Invalid payload. "forecast" array of days is required.' },
        { status: 400 }
      );
    }

    const sql = getDb();
    for (const day of forecast) {
      const { date, probability, precipitation_mm, temp_c, description } = day;
      if (!date || probability === undefined || precipitation_mm === undefined) {
        continue;
      }
      
      await sql`
        INSERT INTO weather_forecast_cache (forecast_date, precipitation_probability, expected_precipitation_mm, raw_payload, updated_at)
        VALUES (
          ${date}::date, 
          ${parseFloat(probability)}, 
          ${parseFloat(precipitation_mm)}, 
          ${JSON.stringify({ temp_c: temp_c || 20, description: description || 'Clear' })}::jsonb,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (forecast_date) DO UPDATE
        SET 
          precipitation_probability = EXCLUDED.precipitation_probability,
          expected_precipitation_mm = EXCLUDED.expected_precipitation_mm,
          raw_payload = EXCLUDED.raw_payload,
          updated_at = CURRENT_TIMESTAMP
      `;
    }

    return NextResponse.json({
      success: true,
      message: 'Weather forecast overrides successfully injected into cache.'
    });
  } catch (err) {
    console.error('Failed to inject weather overrides:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to update weather cache.', details: err.message },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
