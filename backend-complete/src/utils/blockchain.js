const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Inizializza database schema
async function initDatabase() {
  console.log('🔧 Inizializzazione database...');
  
  try {
    // Tabella depositi
    await pool.query(`
      CREATE TABLE IF NOT EXISTS deposits (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        amount DECIMAL(18,8) NOT NULL,
        currency VARCHAR(50) NOT NULL,
        tx_hash VARCHAR(100) UNIQUE NOT NULL,
        from_address VARCHAR(50),
        to_address VARCHAR(50),
        block_number BIGINT,
        status VARCHAR(20) DEFAULT 'pending',
        confirmations INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        confirmed_at TIMESTAMP,
        processed_at TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_email);
      CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
      CREATE INDEX IF NOT EXISTS idx_deposits_tx ON deposits(tx_hash);
    `);

    // Tabella prelievi
    await pool.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        amount DECIMAL(18,8) NOT NULL,
        fee DECIMAL(18,8) NOT NULL,
        net_amount DECIMAL(18,8) NOT NULL,
        currency VARCHAR(50) NOT NULL,
        to_address VARCHAR(50) NOT NULL,
        tx_hash VARCHAR(100),
        status VARCHAR(20) DEFAULT 'pending',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        processed_at TIMESTAMP,
        completed_at TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_email);
      CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
    `);

    // Tabella limiti giornalieri
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_limits (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        total_withdrawn DECIMAL(18,8) DEFAULT 0,
        UNIQUE(user_email, date)
      );
      
      CREATE INDEX IF NOT EXISTS idx_limits_user_date ON daily_limits(user_email, date);
    `);

    // Tabella eventi blockchain
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blockchain_events (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL,
        tx_hash VARCHAR(100) NOT NULL,
        block_number BIGINT NOT NULL,
        data JSONB,
        processed BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(tx_hash, event_type)
      );
      
      CREATE INDEX IF NOT EXISTS idx_events_block ON blockchain_events(block_number);
      CREATE INDEX IF NOT EXISTS idx_events_processed ON blockchain_events(processed);
    `);

    // Tabella monitoraggio (ultimo blocco sincronizzato)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sync_state (
        id SERIAL PRIMARY KEY,
        last_block_number BIGINT NOT NULL,
        last_sync_at TIMESTAMP DEFAULT NOW()
      );
      
      INSERT INTO sync_state (last_block_number)
      SELECT 0
      WHERE NOT EXISTS (SELECT 1 FROM sync_state LIMIT 1);
    `);

    console.log('✅ Database inizializzato con successo!');
  } catch (error) {
    console.error('❌ Errore inizializzazione database:', error);
    throw error;
  }
}

// Test connessione
async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connesso:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('❌ Errore connessione database:', error.message);
    return false;
  }
}

module.exports = {
  pool,
  initDatabase,
  testConnection
};

// Se eseguito direttamente, inizializza DB
if (require.main === module) {
  require('dotenv').config();
  initDatabase()
    .then(() => {
      console.log('✅ Setup completato');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Setup fallito:', error);
      process.exit(1);
    });
}
