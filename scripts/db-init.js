import { Client } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

// Setup/Load .env file manually
try {
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of envLines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        if (val.endsWith('\r')) val = val.slice(0, -1);
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
} catch (err) {
  console.warn('Could not read .env file:', err);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Error: DATABASE_URL environment variable is not defined.');
  process.exit(1);
}

const isReset = process.argv.includes('--reset');

async function initializeDatabase() {
  try {
    console.log('Connecting to NeonDB via Client...');
    const client = new Client({
      connectionString: databaseUrl
    });
    await client.connect();

    if (isReset) {
      console.log('Reset flag provided. Dropping existing tables...');
      const drops = [
        'DROP TABLE IF EXISTS sensor_readings CASCADE',
        'DROP TABLE IF EXISTS command_logs CASCADE',
        'DROP TABLE IF EXISTS sensor_logs CASCADE',
        'DROP TABLE IF EXISTS system_config CASCADE',
        'DROP TABLE IF EXISTS sensor_configs CASCADE',
        'DROP TABLE IF EXISTS pump_configs CASCADE',
        'DROP TABLE IF EXISTS system_notes CASCADE'
      ];
      for (const drop of drops) {
        console.log(`Executing: ${drop}...`);
        await client.query(drop);
      }
    }

    const schemaPath = path.resolve('schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`schema.sql not found at ${schemaPath}`);
    }

    const sqlContent = fs.readFileSync(schemaPath, 'utf8');

    console.log('Executing database schema...');
    await client.query(sqlContent);
    
    console.log('Database initialization completed successfully.');
    await client.end();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

initializeDatabase();
