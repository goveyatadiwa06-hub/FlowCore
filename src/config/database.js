const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is missing. Check your .env file.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Catch unexpected errors on idle clients
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

// Test database connection at startup
async function connectDB() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();

    console.log('✅ PostgreSQL connected at:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('\n❌ DATABASE CONNECTION FAILED\n');
    console.error(error);   // shows full error
    console.error('\nCheck:');
    console.error('- DATABASE_URL');
    console.error('- Supabase password');
    console.error('- Session pooler URL');
    console.error('- .env loading\n');
    process.exit(1);
  }
}

module.exports = {
  pool,
  connectDB,
};
