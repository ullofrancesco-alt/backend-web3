const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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

async function initDatabase() {
  const createDepositsTable = `
    CREATE TABLE IF NOT EXISTS deposits (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(255) NOT NULL,
      user_wallet_address VARCHAR(42) NOT NULL,
      amount DECIMAL(20, 6) NOT NULL,
      currency VARCHAR(50) NOT NULL,
      tx_hash VARCHAR(66) UNIQUE NOT NULL,
      block_number BIGINT NOT NULL,
      status VARCHAR(20) DEFAULT 'confirmed',
      created_at TIMESTAMP DEFAULT NOW(),
      processed_at TIMESTAMP
    );
  `;
  
  const createWithdrawalsTable = `
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(255) NOT NULL,
      amount DECIMAL(20, 6) NOT NULL,
      currency VARCHAR(50) NOT NULL,
      to_address VARCHAR(42) NOT NULL,
      tx_hash VARCHAR(66),
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      processed_at TIMESTAMP
    );
  `;
  
  await pool.query(createDepositsTable);
  await pool.query(createWithdrawalsTable);
  
  console.log('✅ Tabelle database OK');
}

async function saveDeposit(data) {
  const { userEmail, userWalletAddress, amount, currency, txHash, blockNumber, status } = data;
  
  // Check if already exists
  const existing = await pool.query('SELECT id FROM deposits WHERE tx_hash = $1', [txHash]);
  if (existing.rows.length > 0) {
    console.log('⚠️ Deposito già esistente, skip');
    return existing.rows[0].id;
  }
  
  const result = await pool.query(
    'INSERT INTO deposits (user_email, user_wallet_address, amount, currency, tx_hash, block_number, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [userEmail, userWalletAddress, amount, currency, txHash, blockNumber, status]
  );
  
  return result.rows[0].id;
}

async function getPendingDeposits(userEmail) {
  const result = await pool.query(
    'SELECT * FROM deposits WHERE user_email = $1 AND processed_at IS NULL ORDER BY created_at DESC',
    [userEmail]
  );
  return result.rows;
}

async function markDepositsProcessed(depositIds) {
  await pool.query(
    'UPDATE deposits SET processed_at = NOW() WHERE id = ANY($1)',
    [depositIds]
  );
}

async function createWithdrawalRequest(data) {
  const { userEmail, amount, currency, toAddress } = data;
  
  const result = await pool.query(
    'INSERT INTO withdrawals (user_email, amount, currency, to_address, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [userEmail, amount, currency, toAddress, 'pending']
  );
  
  return result.rows[0].id;
}

async function getPendingWithdrawals() {
  const result = await pool.query(
    'SELECT * FROM withdrawals WHERE status = $1 ORDER BY created_at ASC',
    ['pending']
  );
  return result.rows;
}

async function updateWithdrawalStatus(id, status, txHash = null) {
  await pool.query(
    'UPDATE withdrawals SET status = $1, tx_hash = $2, processed_at = NOW() WHERE id = $3',
    [status, txHash, id]
  );
}

module.exports = {
  testConnection,
  initDatabase,
  saveDeposit,
  getPendingDeposits,
  markDepositsProcessed,
  createWithdrawalRequest,
  getPendingWithdrawals,
  updateWithdrawalStatus
};
