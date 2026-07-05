export function getWeatherDescription(code) {
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

export function getMockForecast() {
  const forecast = [];
  const today = new Date();
  
  for (let i = 0; i < 5; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    
    let prob = 0.1;
    let mm = 0.0;
    let desc = 'Sunny with clear skies';
    let temp = 22 + Math.sin(i) * 3;
    
    if (i === 1) {
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

export async function fetchLiveForecast(lat, lng) {
  const forecastData = [];
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,precipitation_sum,precipitation_probability_max&timezone=auto`;
  
  const apiRes = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!apiRes.ok) {
    throw new Error(`Open-Meteo API returned status ${apiRes.status}`);
  }
  
  const apiJson = await apiRes.json();
  const daily = apiJson.daily || {};
  const times = daily.time || [];
  
  for (let i = 0; i < times.length; i++) {
    const rawProb = daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : 0;
    const wCode = daily.weather_code ? daily.weather_code[i] : 0;
    
    forecastData.push({
      forecast_date: times[i],
      precipitation_probability: Number(rawProb) / 100,
      expected_precipitation_mm: daily.precipitation_sum ? parseFloat(daily.precipitation_sum[i]) : 0.0,
      temp_c: daily.temperature_2m_max ? parseFloat(daily.temperature_2m_max[i]) : 22.0,
      description: getWeatherDescription(wCode)
    });
  }
  
  return forecastData;
}
