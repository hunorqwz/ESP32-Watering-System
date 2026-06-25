import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Error: DATABASE_URL environment variable is not defined.');
  process.exit(1);
}

async function initializeDatabase() {
  try {
    const schemaPath = path.resolve('schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`schema.sql not found at ${schemaPath}`);
    }

    const sqlContent = fs.readFileSync(schemaPath, 'utf8');
    
    // Split schema file into individual SQL queries
    const queries = sqlContent
      .split(';')
      .map(q => q.trim())
      .filter(q => q.length > 0);

    console.log('Connecting to NeonDB and executing schema queries...');
    const sql = neon(databaseUrl);
    
    for (const query of queries) {
      console.log(`Executing statement: ${query.split('\n')[0]}...`);
      await sql.query(query);
    }
    
    console.log('Database initialization completed successfully.');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

initializeDatabase();
