/**
 * Calculates current water volume in the reservoir in liters based on Raw Sensor Distance (cm)
 * and active system calibrations.
 * 
 * @param {Function} sql - Neon postgres client instance
 * @param {number} rawDistance - Distance in cm from sensor to water surface
 * @returns {Promise<number|null>} Liters of water remaining, rounded to 1 decimal place (or null if invalid distance)
 */
export async function getReservoirVolume(sql, rawDistance) {
  if (rawDistance === undefined || rawDistance === null || isNaN(rawDistance) || rawDistance <= 0) {
    return null;
  }

  // Fetch all reservoir settings
  const configs = await sql`
    SELECT key, value FROM system_config 
    WHERE key IN (
      'reservoir_sensor_offset_cm', 
      'reservoir_height_cm', 
      'reservoir_use_dimensions', 
      'reservoir_total_volume_liters', 
      'reservoir_width_cm', 
      'reservoir_length_cm'
    )
  `;

  const configMap = {};
  configs.forEach(cfg => {
    configMap[cfg.key] = cfg.value;
  });

  // Get fallback dry limit from sensor configs if offset is missing
  let defaultDryLimit = 100;
  try {
    const waterSensor = await sql`
      SELECT dry_limit FROM sensor_configs WHERE type = 'water_level' LIMIT 1
    `;
    if (waterSensor.length > 0 && waterSensor[0].dry_limit !== null) {
      defaultDryLimit = waterSensor[0].dry_limit;
    }
  } catch (err) {
    console.error('Error fetching fallback water sensor config:', err.message);
  }

  const emptyDist = configMap['reservoir_sensor_offset_cm']
    ? parseFloat(configMap['reservoir_sensor_offset_cm'])
    : defaultDryLimit;
  const heightCm = configMap['reservoir_height_cm']
    ? parseFloat(configMap['reservoir_height_cm'])
    : 50;

  const useDimensions = configMap['reservoir_use_dimensions'] === 'true';
  const totalVolume = configMap['reservoir_total_volume_liters'] ? parseFloat(configMap['reservoir_total_volume_liters']) : 100;
  const width = configMap['reservoir_width_cm'] ? parseFloat(configMap['reservoir_width_cm']) : 60;
  const length = configMap['reservoir_length_cm'] ? parseFloat(configMap['reservoir_length_cm']) : 70;

  // Calculate actual water height from bottom of the tank
  let waterHeight = emptyDist - rawDistance;
  if (waterHeight < 0) waterHeight = 0;
  if (waterHeight > heightCm) waterHeight = heightCm;

  // Convert height to liters based on calibration method
  let liters = 0;
  if (useDimensions) {
    // Volume = (Width * Length * Height) / 1000 cubic cm to Liters
    liters = (width * length * waterHeight) / 1000;
  } else {
    // Volume = Total Volume * Fill Percentage
    const percentage = waterHeight / heightCm;
    liters = totalVolume * percentage;
  }

  return Math.round(liters * 10) / 10;
}
