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
