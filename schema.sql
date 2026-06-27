CREATE TABLE IF NOT EXISTS sensor_logs (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL,
    m1 INT NOT NULL,          -- Moisture sensor 1
    m2 INT NOT NULL,          -- Moisture sensor 2
    m3 INT NOT NULL,          -- Moisture sensor 3
    m4 INT NOT NULL,          -- Moisture sensor 4
    m5 INT NOT NULL,          -- Moisture sensor 5
    temp REAL,                -- Temperature in Celsius
    hum REAL,                 -- Humidity percentage
    water_level REAL,         -- Water level percentage/value
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sensor_logs_device_created ON sensor_logs (device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_logs_created ON sensor_logs (created_at DESC);

-- Table for system configuration settings (shared between ESP32 and dashboard)
CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(50) PRIMARY KEY,
    value VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed default telemetry update interval (15 minutes)
INSERT INTO system_config (key, value)
VALUES ('telemetry_interval_minutes', '15')
ON CONFLICT (key) DO NOTHING;

-- Seed WiFi parameters for the ESP32
INSERT INTO system_config (key, value)
VALUES 
    ('wifi_ssid', 'TerraceWiFi'),
    ('wifi_password', 'secretPassword')
ON CONFLICT (key) DO NOTHING;

-- Seed default soil moisture calibration values (1100 for Wet, 3400 for Dry)
INSERT INTO system_config (key, value)
VALUES 
    ('sensor_m1_dry', '3400'),
    ('sensor_m1_wet', '1100'),
    ('sensor_m2_dry', '3400'),
    ('sensor_m2_wet', '1100'),
    ('sensor_m3_dry', '3400'),
    ('sensor_m3_wet', '1100'),
    ('sensor_m4_dry', '3400'),
    ('sensor_m4_wet', '1100'),
    ('sensor_m5_dry', '3400'),
    ('sensor_m5_wet', '1100')
ON CONFLICT (key) DO NOTHING;

-- Seed default reservoir calibration values (empty = 100cm, full = 10cm, capacity = 100L, dimensions = 60x70)
INSERT INTO system_config (key, value)
VALUES 
    ('reservoir_empty_distance_cm', '100'),
    ('reservoir_full_distance_cm', '0'),
    ('reservoir_use_dimensions', 'false'),
    ('reservoir_total_volume_liters', '100'),
    ('reservoir_width_cm', '60'),
    ('reservoir_length_cm', '70')
ON CONFLICT (key) DO NOTHING;


-- NEW RELATIONAL SYSTEM SCHEMAS
-- 1. Table for dynamic sensor configurations
CREATE TABLE IF NOT EXISTS sensor_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,            -- 'moisture', 'temperature', 'humidity', 'water_level'
    pin INT NOT NULL,
    sensor_group VARCHAR(100) NOT NULL,
    dry_limit INT DEFAULT 3400,           -- Analog limit for dry soil/empty tank
    wet_limit INT DEFAULT 1100,           -- Analog limit for wet soil/full tank
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed default sensors into metadata configurations
INSERT INTO sensor_configs (id, name, type, pin, sensor_group, dry_limit, wet_limit)
VALUES 
    (1, 'Zone 1', 'moisture', 32, 'Soil Moisture', 3400, 1100),
    (2, 'Zone 2', 'moisture', 33, 'Soil Moisture', 3400, 1100),
    (3, 'Zone 3', 'moisture', 34, 'Soil Moisture', 3400, 1100),
    (4, 'Zone 4', 'moisture', 35, 'Soil Moisture', 3400, 1100),
    (5, 'Zone 5', 'moisture', 36, 'Soil Moisture', 3400, 1100),
    (6, 'Ambient Temp', 'temperature', 4, 'Environment', NULL, NULL),
    (7, 'Ambient Humidity', 'humidity', 4, 'Environment', NULL, NULL),
    (8, 'Reservoir Level', 'water_level', 27, 'Reservoir', 100, 0)
ON CONFLICT (id) DO NOTHING;

-- 2. Table for dynamic pump configurations
CREATE TABLE IF NOT EXISTS pump_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    pin INT NOT NULL,
    state INT NOT NULL DEFAULT 0,          -- 0 = Off, 1 = On
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed default pump outputs
INSERT INTO pump_configs (id, name, pin, state)
VALUES
    (1, 'Pump 1', 25, 0),
    (2, 'Pump 2', 26, 0),
    (3, 'Pump 3', 27, 0),
    (4, 'Pump 4', 14, 0)
ON CONFLICT (id) DO NOTHING;

-- Table for historical tracking of issued control commands
CREATE TABLE IF NOT EXISTS command_logs (
    id SERIAL PRIMARY KEY,
    pump INT NOT NULL REFERENCES pump_configs(id) ON DELETE CASCADE,
    state INT NOT NULL CHECK (state IN (0, 1)),
    status VARCHAR(20) NOT NULL,     -- 'success' or 'failed'
    response_msg_id VARCHAR(100),    -- EMQX message ID on success
    error_details TEXT,              -- Detailed error if publish failed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_command_logs_created ON command_logs (created_at DESC);

-- 3. Table for relational sensor readings logs
CREATE TABLE IF NOT EXISTS sensor_readings (
    id SERIAL PRIMARY KEY,
    sensor_config_id INT NOT NULL REFERENCES sensor_configs(id) ON DELETE CASCADE,
    value REAL NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_config_created ON sensor_readings (sensor_config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_created ON sensor_readings (created_at DESC);
