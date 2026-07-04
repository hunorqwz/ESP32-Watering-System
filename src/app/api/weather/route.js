import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

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

// Helper to generate realistic mock forecast if no API is configured
function getMockForecast() {
  const forecast = [];
  const today = new Date();
  
  for (let i = 0; i < 5; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    
    // Default dry weather, except day 3 has a light shower simulation
    let prob = 0.1;
    let mm = 0.0;
    let desc = 'Sunny with clear skies';
    let temp = 22 + Math.sin(i) * 3;
    
    if (i === 1) {
      // Mock light drizzle for tomorrow
      prob = 0.25;
      mm = 0.5;
      desc = 'Partly cloudy, light showers possible';
    } else if (i === 3) {
      prob = 0.85;
      mm = 6.2;
      desc = 'Overcast with moderate to heavy rain showers';
    }
    
    forecast.push({
      forecast_date: dateStr,
      precipitation_probability: prob,
      expected_precipitation_mm: mm,
      temp_c: Math.round(temp * 10) / 10,
      description: desc
    });
  }
  return forecast;
}

function getWeatherDescription(code) {
  const mapping = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Foggy rime',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow fall',
    73: 'Moderate snow fall',
    75: 'Heavy snow fall',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with light hail',
    99: 'Thunderstorm with heavy hail'
  };
  return mapping[code] || 'Unspecified weather';
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
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,precipitation_sum,precipitation_probability_max&timezone=auto`;
      const apiRes = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (apiRes.ok) {
        const apiJson = await apiRes.json();
        const daily = apiJson.daily || {};
        const times = daily.time || [];
        for (let i = 0; i < times.length; i++) {
          const rawProb = daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : 0;
          forecastData.push({
            forecast_date: times[i],
            precipitation_probability: Number(rawProb) / 100, // Convert e.g. 90% to 0.90
            expected_precipitation_mm: daily.precipitation_sum ? parseFloat(daily.precipitation_sum[i]) : 0.0,
            temp_c: daily.temperature_2m_max ? parseFloat(daily.temperature_2m_max[i]) : 22.0,
            description: getWeatherDescription(daily.weather_code ? daily.weather_code[i] : 0)
          });
        }
      }
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

// POST: Allows manual override/injection (crucial for integration tests simulating tomorrow's heavy rain)
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
