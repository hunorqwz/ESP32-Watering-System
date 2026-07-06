-- Table for system configuration settings (shared between ESP32 and dashboard)
CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(50) PRIMARY KEY,
    value VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- RELATIONAL SYSTEM SCHEMAS
-- 1. Table for dynamic pump configurations
CREATE TABLE IF NOT EXISTS pump_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    pin INT NOT NULL,
    state INT NOT NULL DEFAULT 0,          -- 0 = Off, 1 = On
    flow_rate_lpm REAL DEFAULT 4.0,        -- Liters per minute flow rate
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Table for dynamic sensor configurations
CREATE TABLE IF NOT EXISTS sensor_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,            -- 'moisture', 'temperature', 'humidity', 'water_level'
    pin INT NOT NULL,
    pin_secondary INT,                    -- Secondary pin (e.g. Echo pin for ultrasonic sensor)
    sensor_group VARCHAR(100) NOT NULL,
    dry_limit INT DEFAULT 3400,           -- Analog limit for dry soil/empty tank
    wet_limit INT DEFAULT 1100,           -- Analog limit for wet soil/full tank
    pump_id INT REFERENCES pump_configs(id) ON DELETE SET NULL,
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


-- Table for dynamic watering flows (zones mapping pumps to multiple sensors)
CREATE TABLE IF NOT EXISTS watering_flows (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    pump_id INT NOT NULL REFERENCES pump_configs(id) ON DELETE CASCADE,
    sensor_ids INT[] NOT NULL,           -- e.g. [1, 2, 3] targeting multiple moisture sensors
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- Table for dynamic watering schedules
CREATE TABLE IF NOT EXISTS watering_schedules (
    id SERIAL PRIMARY KEY,
    pump_ids INT[],                        -- Legacy support
    flow_ids INT[],                        -- e.g. [1, 2] targeting multiple watering flows
    time_of_day TIME NOT NULL,
    duration_seconds INT NOT NULL CHECK (duration_seconds > 0),
    days_of_week INT[] NOT NULL,           -- e.g. [1, 2, 3, 4, 5, 6, 7] where 1 = Monday, 7 = Sunday
    enabled BOOLEAN DEFAULT TRUE,
    cycles INT DEFAULT 1 CHECK (cycles > 0),
    soak_duration_seconds INT DEFAULT 0 CHECK (soak_duration_seconds >= 0),
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

-- Table for user authentication
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(100) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- Functions and triggers to enforce relational integrity on array fields
CREATE OR REPLACE FUNCTION validate_watering_flow_sensors() RETURNS TRIGGER AS $$
DECLARE
    invalid_sensor_id INT;
BEGIN
    SELECT val INTO invalid_sensor_id
    FROM unnest(NEW.sensor_ids) AS val
    LEFT JOIN sensor_configs s ON s.id = val
    WHERE s.id IS NULL
    LIMIT 1;

    IF invalid_sensor_id IS NOT NULL THEN
        RAISE EXCEPTION 'Sensor ID % does not exist in sensor_configs', invalid_sensor_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_validate_watering_flow_sensors
BEFORE INSERT OR UPDATE ON watering_flows
FOR EACH ROW EXECUTE FUNCTION validate_watering_flow_sensors();

CREATE OR REPLACE FUNCTION validate_watering_schedule_refs() RETURNS TRIGGER AS $$
DECLARE
    invalid_flow_id INT;
    invalid_pump_id INT;
BEGIN
    IF NEW.flow_ids IS NOT NULL THEN
        SELECT val INTO invalid_flow_id
        FROM unnest(NEW.flow_ids) AS val
        LEFT JOIN watering_flows f ON f.id = val
        WHERE f.id IS NULL
        LIMIT 1;

        IF invalid_flow_id IS NOT NULL THEN
            RAISE EXCEPTION 'Flow ID % does not exist in watering_flows', invalid_flow_id;
        END IF;
    END IF;

    IF NEW.pump_ids IS NOT NULL THEN
        SELECT val INTO invalid_pump_id
        FROM unnest(NEW.pump_ids) AS val
        LEFT JOIN pump_configs p ON p.id = val
        WHERE p.id IS NULL
        LIMIT 1;

        IF invalid_pump_id IS NOT NULL THEN
            RAISE EXCEPTION 'Pump ID % does not exist in pump_configs', invalid_pump_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_validate_watering_schedule_refs
BEFORE INSERT OR UPDATE ON watering_schedules
FOR EACH ROW EXECUTE FUNCTION validate_watering_schedule_refs();


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
            ('reservoir_sensor_offset_cm', '100'),
            ('timezone', 'Europe/Bucharest'),
            ('moisture_skip_threshold_percent', '70'),
            ('reservoir_min_volume_liters', '5.0'),
            ('pump_safety_timeout_seconds', '300');
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

    -- 5. Seed default user if empty
    IF NOT EXISTS (SELECT 1 FROM users) THEN
        INSERT INTO users (username, password_hash, email)
        VALUES ('admin', '$2b$10$6XOSZsZUig6nf9qA1BVjO.bfhosbVa7VVP.soJTyiecymkSTxBPTC', 'admin@example.com');
    END IF;
END $$;


-- Sync sequence values to prevent duplicate key constraint violations on insert
SELECT setval(pg_get_serial_sequence('sensor_configs', 'id'), COALESCE(max(id), 1)) FROM sensor_configs;
SELECT setval(pg_get_serial_sequence('pump_configs', 'id'), COALESCE(max(id), 1)) FROM pump_configs;
SELECT setval(pg_get_serial_sequence('system_notes', 'id'), COALESCE(max(id), 1)) FROM system_notes;
SELECT setval(pg_get_serial_sequence('watering_schedules', 'id'), COALESCE(max(id), 1)) FROM watering_schedules;
SELECT setval(pg_get_serial_sequence('watering_flows', 'id'), COALESCE(max(id), 1)) FROM watering_flows;
SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE(max(id), 1)) FROM users;


-- PERFORMANCE INDEXES (GIN index for array query acceleration)
CREATE INDEX IF NOT EXISTS idx_watering_flows_sensors ON watering_flows USING gin (sensor_ids);
CREATE INDEX IF NOT EXISTS idx_watering_schedules_pumps ON watering_schedules USING gin (pump_ids);
CREATE INDEX IF NOT EXISTS idx_watering_schedules_flows ON watering_schedules USING gin (flow_ids);


-- CASCADING DELETE TRIGGERS ON SQL ARRAYS
-- 1. Automatically remove deleted sensors from watering_flows
CREATE OR REPLACE FUNCTION cleanup_sensor_from_flows() RETURNS TRIGGER AS $$
BEGIN
    UPDATE watering_flows
    SET sensor_ids = array_remove(sensor_ids, OLD.id)
    WHERE OLD.id = ANY(sensor_ids);
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cleanup_sensor_from_flows ON sensor_configs;
CREATE TRIGGER trg_cleanup_sensor_from_flows
AFTER DELETE ON sensor_configs
FOR EACH ROW EXECUTE FUNCTION cleanup_sensor_from_flows();


-- 2. Automatically remove deleted pumps from watering_schedules
CREATE OR REPLACE FUNCTION cleanup_pump_from_schedules() RETURNS TRIGGER AS $$
BEGIN
    UPDATE watering_schedules
    SET pump_ids = array_remove(pump_ids, OLD.id)
    WHERE OLD.id = ANY(pump_ids);
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cleanup_pump_from_schedules ON pump_configs;
CREATE TRIGGER trg_cleanup_pump_from_schedules
AFTER DELETE ON pump_configs
FOR EACH ROW EXECUTE FUNCTION cleanup_pump_from_schedules();


-- 3. Automatically remove deleted watering_flows from watering_schedules
CREATE OR REPLACE FUNCTION cleanup_flow_from_schedules() RETURNS TRIGGER AS $$
BEGIN
    UPDATE watering_schedules
    SET flow_ids = array_remove(flow_ids, OLD.id)
    WHERE OLD.id = ANY(flow_ids);
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cleanup_flow_from_schedules ON watering_flows;
CREATE TRIGGER trg_cleanup_flow_from_schedules
AFTER DELETE ON watering_flows
FOR EACH ROW EXECUTE FUNCTION cleanup_flow_from_schedules();

