const express = require('express');
const cors = require('cors');
const { initDatabase, testConnection } = require('./database');
const { initWeb3 } = require('./blockchain');
const { startMonitor } = require('./monitor');
const { startProcessor } = require('./processor');
const { getPendingDeposits, markDepositsProcessed } = require('./database');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
  try {
    const dbStatus = await testConnection();
    res.json({
      status: 'ok',
      database: dbStatus ? 'connected' : 'error',
      monitor: 'active',
      processor: 'active',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get pending deposits for user
app.get('/api/deposits/:email/pending', async (req, res) => {
  try {
    const deposits = await getPendingDeposits(req.params.email);
    res.json(deposits);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark deposits as processed
app.post('/api/deposits/mark-processed', async (req, res) => {
  try {
    const { depositIds } = req.body;
    await markDepositsProcessed(depositIds);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Request withdrawal
app.post('/api/withdrawal/request', async (req, res) => {
  try {
    const { userEmail, amount, currency, toAddress } = req.body;
    
    const { createWithdrawalRequest } = require('./database');
    const withdrawalId = await createWithdrawalRequest({
      userEmail,
      amount,
      currency,
      toAddress
    });
    
    res.json({ 
      success: true, 
      withdrawalId,
      message: 'Prelievo richiesto. Sarà processato entro 2 minuti.' 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Catch-all
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint non trovato' });
});

// Start server
async function start() {
  console.log('🚀 Avvio Epistocracy Backend...\n');
  
  try {
    // 1. Test database
    console.log('1️⃣ Test connessione database...');
    const dbOk = await testConnection();
    if (!dbOk) throw new Error('Database non raggiungibile');
    console.log('✅ Database connesso\n');
    
    // 2. Init database
    console.log('2️⃣ Inizializzazione tabelle...');
    await initDatabase();
    console.log('✅ Database inizializzato\n');
    
    // 3. Init Web3
    console.log('3️⃣ Inizializzazione Web3...');
    await initWeb3();
    console.log('✅ Web3 inizializzato\n');
    
    // 4. Start HTTP server
    console.log('4️⃣ Avvio server HTTP...');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Server in ascolto su porta ${PORT}\n`);
    });
    
    // 5. Start monitor (after 5 seconds)
    console.log('5️⃣ Avvio monitor (tra 5 secondi)...');
    setTimeout(() => {
      startMonitor();
    }, 5000);
    
    // 6. Start processor (after 10 seconds)
    console.log('6️⃣ Avvio processor (tra 10 secondi)...');
    setTimeout(() => {
      startProcessor();
    }, 10000);
    
    console.log('✅ SISTEMA AVVIATO COMPLETAMENTE\n');
    
  } catch (error) {
    console.error('❌ Errore startup:', error);
    process.exit(1);
  }
}

start();
