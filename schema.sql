-- Table for system configuration settings (shared between ESP32 and dashboard)
CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(50) PRIMARY KEY,
    value VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- RELATIONAL SYSTEM SCHEMAS
-- 1. Table for dynamic sensor configurations
CREATE TABLE IF NOT EXISTS sensor_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,            -- 'moisture', 'temperature', 'humidity', 'water_level'
    pin INT NOT NULL,
    pin_secondary INT,                    -- Secondary pin (e.g. Echo pin for ultrasonic sensor)
    sensor_group VARCHAR(100) NOT NULL,
    dry_limit INT DEFAULT 3400,           -- Analog limit for dry soil/empty tank
    wet_limit INT DEFAULT 1100,           -- Analog limit for wet soil/full tank
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Table for dynamic pump configurations
CREATE TABLE IF NOT EXISTS pump_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    pin INT NOT NULL,
    state INT NOT NULL DEFAULT 0,          -- 0 = Off, 1 = On
    flow_rate_lpm REAL DEFAULT 4.0,        -- Liters per minute flow rate
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for historical tracking of issued control commands with audit trail snapshots
CREATE TABLE IF NOT EXISTS command_logs (
    id SERIAL PRIMARY KEY,
    pump INT REFERENCES pump_configs(id) ON DELETE SET NULL,
    pump_name VARCHAR(100),                -- Snapshot pump name for deletion audit
    pump_pin INT,                          -- Snapshot pump pin for deletion audit
    state INT NOT NULL CHECK (state IN (0, 1)),
    status VARCHAR(20) NOT NULL,           -- 'success' or 'failed'
    response_msg_id VARCHAR(100),          -- EMQX message ID on success
    error_details TEXT,                    -- Detailed error if publish failed
    duration_seconds INT,                  -- Calculated runtime on transition to OFF
    water_used_liters REAL,                 -- Calculated consumption on transition to OFF
    start_volume_liters REAL,              -- Reservoir volume in liters when pump turned ON
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_command_logs_created ON command_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_command_logs_pump ON command_logs (pump);

-- 3. Table for relational sensor readings logs
CREATE TABLE IF NOT EXISTS sensor_readings (
    id SERIAL PRIMARY KEY,
    sensor_config_id INT NOT NULL REFERENCES sensor_configs(id) ON DELETE CASCADE,
    value REAL NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_config_created ON sensor_readings (sensor_config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_created ON sensor_readings (created_at DESC);

-- Table for user-created persistent notes and logs
CREATE TABLE IF NOT EXISTS system_notes (
    id SERIAL PRIMARY KEY,
    title VARCHAR(100) DEFAULT 'Untitled Note',
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- Table for dynamic watering schedules
CREATE TABLE IF NOT EXISTS watering_schedules (
    id SERIAL PRIMARY KEY,
    pump_ids INT[] NOT NULL,               -- e.g. [1, 2] targeting multiple pumps
    time_of_day TIME NOT NULL,
    duration_seconds INT NOT NULL CHECK (duration_seconds > 0),
    days_of_week INT[] NOT NULL,           -- e.g. [1, 2, 3, 4, 5, 6, 7] where 1 = Monday, 7 = Sunday
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for caching weather forecasts to respect rate limits
CREATE TABLE IF NOT EXISTS weather_forecast_cache (
    id SERIAL PRIMARY KEY,
    forecast_date DATE UNIQUE NOT NULL,
    precipitation_probability REAL NOT NULL CHECK (precipitation_probability >= 0 AND precipitation_probability <= 1),
    expected_precipitation_mm REAL NOT NULL CHECK (expected_precipitation_mm >= 0),
    raw_payload JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- CONDITIONAL DATA SEEDING (Executes only if tables are completely empty)
DO $$
BEGIN
    -- 1. Seed system configs if empty
    IF NOT EXISTS (SELECT 1 FROM system_config) THEN
        INSERT INTO system_config (key, value)
        VALUES 
            ('telemetry_interval_minutes', '15'),
            ('wifi_ssid', 'TerraceWiFi'),
            ('wifi_password', 'secretPassword'),
            ('reservoir_use_dimensions', 'false'),
            ('reservoir_total_volume_liters', '100'),
            ('reservoir_width_cm', '60'),
            ('reservoir_length_cm', '70'),
            ('reservoir_height_cm', '50'),
            ('reservoir_sensor_offset_cm', '100');
    END IF;

    -- 2. Seed default sensors if empty
    IF NOT EXISTS (SELECT 1 FROM sensor_configs) THEN
        INSERT INTO sensor_configs (id, name, type, pin, pin_secondary, sensor_group, dry_limit, wet_limit)
        VALUES 
            (1, 'Zone 1', 'moisture', 32, NULL, 'Soil Moisture', 3400, 1100),
            (2, 'Zone 2', 'moisture', 33, NULL, 'Soil Moisture', 3400, 1100),
            (3, 'Zone 3', 'moisture', 34, NULL, 'Soil Moisture', 3400, 1100),
            (4, 'Zone 4', 'moisture', 35, NULL, 'Soil Moisture', 3400, 1100),
            (5, 'Zone 5', 'moisture', 36, NULL, 'Soil Moisture', 3400, 1100),
            (6, 'Ambient Temp', 'temperature', 4, NULL, 'Environment', NULL, NULL),
            (7, 'Ambient Humidity', 'humidity', 4, NULL, 'Environment', NULL, NULL),
            (8, 'Reservoir Level', 'water_level', 14, 27, 'Reservoir', 100, 0);
    END IF;

    -- 3. Seed default pumps if empty
    IF NOT EXISTS (SELECT 1 FROM pump_configs) THEN
        INSERT INTO pump_configs (id, name, pin, state, flow_rate_lpm)
        VALUES
            (1, 'Pump 1', 25, 0, 4.0),
            (2, 'Pump 2', 26, 0, 4.0),
            (3, 'Pump 3', 18, 0, 4.0),
            (4, 'Pump 4', 19, 0, 4.0);
    END IF;

    -- 4. Seed dynamic welcome note if empty
    IF NOT EXISTS (SELECT 1 FROM system_notes) THEN
        INSERT INTO system_notes (title, content)
        VALUES ('Welcome Note', 'This is your gardening notebook. Use this space to write down reminders, watering schedules, or system observations!');
    END IF;
END $$;


-- Sync sequence values to prevent duplicate key constraint violations on insert
SELECT setval(pg_get_serial_sequence('sensor_configs', 'id'), COALESCE(max(id), 1)) FROM sensor_configs;
SELECT setval(pg_get_serial_sequence('pump_configs', 'id'), COALESCE(max(id), 1)) FROM pump_configs;
SELECT setval(pg_get_serial_sequence('system_notes', 'id'), COALESCE(max(id), 1)) FROM system_notes;
SELECT setval(pg_get_serial_sequence('watering_schedules', 'id'), COALESCE(max(id), 1)) FROM watering_schedules;
