require('dotenv').config();
const { pool } = require('./database');
const blockchain = require('./utils/blockchain');

// Verifica se transazione è già stata processata
async function isTransactionProcessed(txHash) {
  const result = await pool.query(
    'SELECT id FROM deposits WHERE tx_hash = $1',
    [txHash]
  );
  return result.rows.length > 0;
}

// Salva deposito nel database
async function saveDeposit(depositData) {
  try {
    const { currency, amount, from, to, txHash, blockNumber } = depositData;

    // Controlla se già esiste
    if (await isTransactionProcessed(txHash)) {
      console.log(`⏭️ Transazione ${txHash} già processata`);
      return;
    }

    // Ottieni conferme
    const confirmations = await blockchain.getConfirmations(txHash);
    const minConfirmations = parseInt(process.env.MIN_CONFIRMATIONS || 12);
    const status = confirmations >= minConfirmations ? 'confirmed' : 'pending';

    // Inserisci nel database
    await pool.query(`
      INSERT INTO deposits (
        user_email, amount, currency, tx_hash, from_address, 
        to_address, block_number, status, confirmations
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (tx_hash) DO UPDATE SET
        confirmations = $9,
        status = $8,
        confirmed_at = CASE WHEN $8 = 'confirmed' THEN NOW() ELSE deposits.confirmed_at END
    `, [
      'unknown@temp.com', // Placeholder, frontend associerà dopo
      amount,
      currency,
      txHash,
      from.toLowerCase(),
      to.toLowerCase(),
      blockNumber,
      status,
      confirmations
    ]);

    console.log(`✅ Deposito salvato: ${amount} ${currency} (TX: ${txHash.substring(0, 10)}...)`);
    console.log(`   Status: ${status} (${confirmations}/${minConfirmations} conferme)`);

  } catch (error) {
    console.error('❌ Errore salvataggio deposito:', error);
  }
}

// Aggiorna conferme depositi pendenti
async function updatePendingDeposits() {
  try {
    const result = await pool.query(`
      SELECT id, tx_hash, currency
      FROM deposits
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 50
    `);

    if (result.rows.length === 0) return;

    console.log(`🔄 Aggiorno ${result.rows.length} depositi pendenti...`);

    for (const deposit of result.rows) {
      const confirmations = await blockchain.getConfirmations(deposit.tx_hash);
      const minConfirmations = parseInt(process.env.MIN_CONFIRMATIONS || 12);

      if (confirmations >= minConfirmations) {
        await pool.query(`
          UPDATE deposits
          SET status = 'confirmed',
              confirmations = $1,
              confirmed_at = NOW()
          WHERE id = $2
        `, [confirmations, deposit.id]);

        console.log(`✅ Deposito ${deposit.id} confermato (${confirmations} conferme)`);
      } else {
        await pool.query(`
          UPDATE deposits
          SET confirmations = $1
          WHERE id = $2
        `, [confirmations, deposit.id]);
      }
    }

  } catch (error) {
    console.error('❌ Errore update depositi:', error);
  }
}

// Monitor principale
async function startMonitor() {
  console.log('🚀 Avvio Blockchain Monitor...');
  console.log(`📍 Wallet: ${process.env.PLATFORM_WALLET_ADDRESS}`);
  console.log(`🔗 RPC: ${process.env.POLYGON_RPC_URL.substring(0, 50)}...`);

  // Connetti WebSocket
  await blockchain.connectWebSocket();

  // Ascolta nuovi depositi in real-time
  await blockchain.listenToDeposits(async (depositData) => {
    console.log('\n💰 NUOVO DEPOSITO RILEVATO!');
    console.log(`   Amount: ${depositData.amount} ${depositData.currency}`);
    console.log(`   From: ${depositData.from}`);
    console.log(`   TX: ${depositData.txHash}`);
    
    await saveDeposit(depositData);
  });

  // Aggiorna depositi pendenti ogni 30 secondi
  setInterval(updatePendingDeposits, 30000);

  console.log('\n✅ Monitor attivo e in ascolto...\n');
}

// Gestione errori e restart
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  setTimeout(() => {
    console.log('🔄 Riavvio monitor...');
    startMonitor();
  }, 5000);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});

// Gestione chiusura pulita
process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM ricevuto, chiusura...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('⚠️ SIGINT ricevuto, chiusura...');
  process.exit(0);
});

// Avvia monitor
if (require.main === module) {
  startMonitor().catch((error) => {
    console.error('❌ Errore fatale:', error);
    process.exit(1);
  });
}

module.exports = { startMonitor, saveDeposit, updatePendingDeposits };
