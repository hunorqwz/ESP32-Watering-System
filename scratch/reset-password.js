import { Client } from '@neondatabase/serverless';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const env = fs.readFileSync('.env', 'utf8');
const config = {};
env.split('\n').forEach(l => {
  const parts = l.split('=');
  if (parts.length >= 2) {
    config[parts[0].trim()] = parts.slice(1).join('=').trim();
  }
});

const connectionString = config.DATABASE_URL;

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  const hash = bcrypt.hashSync('admin123', 10);
  await client.query("UPDATE users SET password_hash = $1 WHERE username = 'admin'", [hash]);
  console.log('Password successfully reset to admin123');
  await client.end();
}
main();
