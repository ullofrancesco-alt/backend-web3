require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { pool, initDatabase, testConnection } = require('./database');
const { startMonitor } = require('./monitor');
const { startProcessor, checkDailyLimit } = require('./processor');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Health check
app.get('/health', async (req, res) => {
  const dbOk = await testConnection();
  res.json({
    status: 'ok',
    database: dbOk ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// GET /api/deposits/:email/pending - Depositi confermati ma non ancora accreditati
app.get('/api/deposits/:email/pending', async (req, res) => {
  try {
    const { email } = req.params;

    const result = await pool.query(`
      SELECT 
        id,
        amount,
        currency,
        tx_hash,
        confirmations,
        created_at,
        confirmed_at
      FROM deposits
      WHERE status = 'confirmed'
        AND processed_at IS NULL
      ORDER BY confirmed_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Errore lettura depositi:', error);
    res.status(500).json({ error: 'Errore server' });
  }
});

// POST /api/deposits/mark-processed - Marca depositi come processati
app.post('/api/deposits/mark-processed', async (req, res) => {
  try {
    const { depositIds } = req.body;

    if (!Array.isArray(depositIds) || depositIds.length === 0) {
      return res.status(400).json({ error: 'depositIds richiesti' });
    }

    await pool.query(`
      UPDATE deposits
      SET processed_at = NOW()
      WHERE id = ANY($1)
    `, [depositIds]);

    res.json({ success: true, processed: depositIds.length });
  } catch (error) {
    console.error('Errore mark processed:', error);
    res.status(500).json({ error: 'Errore server' });
  }
});

// POST /api/withdrawal/request - Richiesta prelievo
app.post('/api/withdrawal/request', async (req, res) => {
  try {
    const { userEmail, amount, currency, toAddress } = req.body;

    // Validazione input
    if (!userEmail || !amount || !currency || !toAddress) {
      return res.status(400).json({ error: 'Dati mancanti' });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: 'Importo non valido' });
    }

    // Valida indirizzo Ethereum
    if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
      return res.status(400).json({ error: 'Indirizzo wallet non valido' });
    }

    // Verifica limite giornaliero
    const limitCheck = await checkDailyLimit(userEmail, amount);
    if (!limitCheck.allowed) {
      return res.status(429).json({
        error: limitCheck.message,
        remaining: limitCheck.remaining
      });
    }

    // Calcola fee
    const feePercent = parseFloat(process.env.WITHDRAWAL_FEE_PERCENT || 1);
    const fee = amount * (feePercent / 100);
    const netAmount = amount - fee;

    // Inserisci richiesta
    const result = await pool.query(`
      INSERT INTO withdrawals (
        user_email, amount, fee, net_amount, currency, to_address, status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      RETURNING id
    `, [userEmail, amount, fee, netAmount, currency, toAddress]);

    res.json({
      success: true,
      withdrawalId: result.rows[0].id,
      amount,
      fee,
      netAmount,
      message: 'Prelievo in coda, sarà processato entro 2 minuti'
    });

  } catch (error) {
    console.error('Errore richiesta prelievo:', error);
    res.status(500).json({ error: 'Errore server' });
  }
});

// GET /api/withdrawal/status/:id - Status prelievo
app.get('/api/withdrawal/status/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT id, status, tx_hash, error_message, created_at, completed_at
      FROM withdrawals
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prelievo non trovato' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Errore status prelievo:', error);
    res.status(500).json({ error: 'Errore server' });
  }
});

// GET /api/transactions/:email - Storico transazioni utente
app.get('/api/transactions/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    // Unisce depositi e prelievi
    const result = await pool.query(`
      SELECT 
        'deposit' as type,
        amount,
        currency,
        tx_hash,
        status,
        created_at
      FROM deposits
      WHERE user_email = $1
      
      UNION ALL
      
      SELECT 
        'withdrawal' as type,
        net_amount as amount,
        currency,
        tx_hash,
        status,
        created_at
      FROM withdrawals
      WHERE user_email = $1
      
      ORDER BY created_at DESC
      LIMIT $2
    `, [email, limit]);

    res.json(result.rows);
  } catch (error) {
    console.error('Errore storico:', error);
    res.status(500).json({ error: 'Errore server' });
  }
});

// GET /api/stats - Statistiche piattaforma
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM deposits WHERE status = 'confirmed') as total_deposits,
        (SELECT COALESCE(SUM(amount), 0) FROM deposits WHERE status = 'confirmed') as total_deposited,
        (SELECT COUNT(*) FROM withdrawals WHERE status = 'completed') as total_withdrawals,
        (SELECT COALESCE(SUM(net_amount), 0) FROM withdrawals WHERE status = 'completed') as total_withdrawn,
        (SELECT COUNT(*) FROM withdrawals WHERE status = 'pending') as pending_withdrawals
    `);

    res.json(stats.rows[0]);
  } catch (error) {
    console.error('Errore stats:', error);
    res.status(500).json({ error: 'Errore server' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint non trovato' });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({ error: 'Errore server interno' });
});

// Startup
async function start() {
  try {
    console.log('🚀 Avvio Epistocracy Backend...\n');

    // Test database
    console.log('1️⃣ Test connessione database...');
    const dbOk = await testConnection();
    if (!dbOk) {
      throw new Error('Database non raggiungibile');
    }

    // Inizializza tabelle
    console.log('2️⃣ Inizializzazione tabelle...');
    await initDatabase();

    // Avvia server HTTP
    console.log('3️⃣ Avvio server HTTP...');
    app.listen(PORT, () => {
      console.log(`✅ Server in ascolto su porta ${PORT}`);
    });

    // Avvia monitor blockchain (in background)
    console.log('4️⃣ Avvio blockchain monitor...');
    setTimeout(() => {
      startMonitor().catch(console.error);
    }, 2000);

    // Avvia processor prelievi (in background)
    console.log('5️⃣ Avvio withdrawal processor...');
    setTimeout(() => {
      startProcessor().catch(console.error);
    }, 4000);

    console.log('\n✅ SISTEMA COMPLETAMENTE ATTIVO\n');
    console.log('📍 Endpoints disponibili:');
    console.log(`   - GET  /health`);
    console.log(`   - GET  /api/deposits/:email/pending`);
    console.log(`   - POST /api/deposits/mark-processed`);
    console.log(`   - POST /api/withdrawal/request`);
    console.log(`   - GET  /api/withdrawal/status/:id`);
    console.log(`   - GET  /api/transactions/:email`);
    console.log(`   - GET  /api/stats\n`);

  } catch (error) {
    console.error('❌ Errore startup:', error);
    process.exit(1);
  }
}

// Avvia!
start();
