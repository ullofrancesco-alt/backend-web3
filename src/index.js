const express = require('express');
const Web3 = require('web3').default;
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const web3 = new Web3(process.env.POLYGON_RPC_URL);
const db = new Pool({ connectionString: process.env.DATABASE_URL });

// Init database
async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS deposits (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(255),
      amount DECIMAL(18,8),
      currency VARCHAR(50),
      tx_hash VARCHAR(100) UNIQUE,
      from_address VARCHAR(50),
      to_address VARCHAR(50),
      block_number BIGINT,
      confirmations INTEGER DEFAULT 0,
      status VARCHAR(20) DEFAULT 'pending',
      processed BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(255),
      amount DECIMAL(18,8),
      currency VARCHAR(50),
      to_address VARCHAR(50),
      tx_hash VARCHAR(100),
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      processed_at TIMESTAMP
    );
  `);
  console.log('✅ Database initialized');
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    platform_wallet: process.env.PLATFORM_WALLET_ADDRESS
  });
});

// Get depositi non processati per un utente
app.get('/api/deposits/:userEmail/pending', async (req, res) => {
  try {
    const { userEmail } = req.params;
    
    const result = await db.query(
      `SELECT * FROM deposits 
       WHERE user_email = $1 
       AND status = 'confirmed' 
       AND processed = false
       ORDER BY created_at DESC`,
      [userEmail]
    );
    
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Marca depositi come processati
app.post('/api/deposits/mark-processed', async (req, res) => {
  try {
    const { depositIds } = req.body;
    
    await db.query(
      'UPDATE deposits SET processed = true WHERE id = ANY($1)',
      [depositIds]
    );
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Richiesta prelievo
app.post('/api/withdrawal/request', async (req, res) => {
  try {
    const { userEmail, amount, currency, toAddress } = req.body;
    
    // Inserisci richiesta
    const result = await db.query(
      `INSERT INTO withdrawals (user_email, amount, currency, to_address, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [userEmail, amount, currency, toAddress]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get saldo blockchain di un wallet
app.get('/api/balance/:walletAddress/:currency', async (req, res) => {
  try {
    const { walletAddress, currency } = req.params;
    
    const tokenAddresses = {
      'Digital EUR': process.env.DEUR_TOKEN_ADDRESS,
      'Digital USD': process.env.DUSD_TOKEN_ADDRESS,
      'Digital CNH': process.env.DCNY_TOKEN_ADDRESS
    };
    
    const tokenAddress = tokenAddresses[currency];
    if (!tokenAddress) {
      return res.status(400).json({ error: 'Currency not supported' });
    }
    
    const ERC20_ABI = [{
      constant: true,
      inputs: [{ name: '_owner', type: 'address' }],
      name: 'balanceOf',
      outputs: [{ name: 'balance', type: 'uint256' }],
      type: 'function'
    }];
    
    const contract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
    const balance = await contract.methods.balanceOf(walletAddress).call();
    const balanceFormatted = web3.utils.fromWei(balance, 'ether');
    
    res.json({
      walletAddress,
      currency,
      balance: parseFloat(balanceFormatted),
      tokenAddress
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ API Server running on port ${PORT}`);
  });
});
