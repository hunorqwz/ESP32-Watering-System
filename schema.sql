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

-- Index for fast queries ordered by latest telemetry data
CREATE INDEX IF NOT EXISTS idx_sensor_logs_device_created ON sensor_logs (device_id, created_at DESC);

-- Table for historical tracking of issued control commands
CREATE TABLE IF NOT EXISTS command_logs (
    id SERIAL PRIMARY KEY,
    pump INT NOT NULL CHECK (pump BETWEEN 1 AND 4),
    state INT NOT NULL CHECK (state IN (0, 1)),
    status VARCHAR(20) NOT NULL,     -- 'success' or 'failed'
    response_msg_id VARCHAR(100),    -- EMQX message ID on success
    error_details TEXT,              -- Detailed error if publish failed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast queries sorted by execution time
CREATE INDEX IF NOT EXISTS idx_command_logs_created ON command_logs (created_at DESC);

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
