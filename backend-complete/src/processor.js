require('dotenv').config();
const { pool } = require('./database');
const blockchain = require('./utils/blockchain');

// Verifica limite giornaliero utente
async function checkDailyLimit(userEmail, amount) {
  try {
    const maxDaily = parseFloat(process.env.MAX_DAILY_WITHDRAWAL || 10000);
    
    const result = await pool.query(`
      SELECT COALESCE(SUM(net_amount), 0) as total
      FROM withdrawals
      WHERE user_email = $1
        AND DATE(created_at) = CURRENT_DATE
        AND status IN ('completed', 'processing')
    `, [userEmail]);

    const todayTotal = parseFloat(result.rows[0].total);
    const newTotal = todayTotal + amount;

    if (newTotal > maxDaily) {
      return {
        allowed: false,
        message: `Limite giornaliero superato: ${newTotal.toFixed(2)} / ${maxDaily} (max)`,
        remaining: maxDaily - todayTotal
      };
    }

    return {
      allowed: true,
      remaining: maxDaily - newTotal
    };

  } catch (error) {
    console.error('Errore verifica limite:', error);
    return { allowed: false, message: 'Errore verifica limite' };
  }
}

// Processa singolo prelievo
async function processWithdrawal(withdrawal) {
  const { id, user_email, amount, currency, to_address } = withdrawal;

  try {
    console.log(`\n📤 Processo prelievo #${id}`);
    console.log(`   Utente: ${user_email}`);
    console.log(`   Amount: ${amount} ${currency}`);
    console.log(`   To: ${to_address}`);

    // Aggiorna status a "processing"
    await pool.query(`
      UPDATE withdrawals
      SET status = 'processing'
      WHERE id = $1
    `, [id]);

    // Invia token sulla blockchain
    const result = await blockchain.sendTokens(to_address, amount, currency);

    if (result.success) {
      // Successo!
      await pool.query(`
        UPDATE withdrawals
        SET status = 'completed',
            tx_hash = $1,
            completed_at = NOW()
        WHERE id = $2
      `, [result.txHash, id]);

      console.log(`✅ Prelievo #${id} completato!`);
      console.log(`   TX Hash: ${result.txHash}`);

    } else {
      // Errore
      await pool.query(`
        UPDATE withdrawals
        SET status = 'failed',
            error_message = $1,
            processed_at = NOW()
        WHERE id = $2
      `, [result.error, id]);

      console.error(`❌ Prelievo #${id} fallito: ${result.error}`);
    }

  } catch (error) {
    console.error(`❌ Errore processo prelievo #${id}:`, error);
    
    await pool.query(`
      UPDATE withdrawals
      SET status = 'failed',
          error_message = $1,
          processed_at = NOW()
      WHERE id = $2
    `, [error.message, id]);
  }
}

// Loop principale: processa prelievi pendenti
async function processPendingWithdrawals() {
  try {
    const result = await pool.query(`
      SELECT *
      FROM withdrawals
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 10
    `);

    if (result.rows.length === 0) {
      return;
    }

    console.log(`\n🔄 Trovati ${result.rows.length} prelievi da processare`);

    for (const withdrawal of result.rows) {
      await processWithdrawal(withdrawal);
      
      // Pausa 2 secondi tra un prelievo e l'altro
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

  } catch (error) {
    console.error('❌ Errore ciclo prelievi:', error);
  }
}

// Avvia processor
async function startProcessor() {
  console.log('🚀 Avvio Withdrawal Processor...');
  console.log(`💳 Wallet: ${process.env.PLATFORM_WALLET_ADDRESS}`);
  console.log(`💰 Fee: ${process.env.WITHDRAWAL_FEE_PERCENT}%`);
  console.log(`📊 Limite giornaliero: ${process.env.MAX_DAILY_WITHDRAWAL}\n`);

  // Processa ogni 15 secondi
  setInterval(processPendingWithdrawals, 15000);

  // Prima esecuzione immediata
  processPendingWithdrawals();

  console.log('✅ Processor attivo\n');
}

// Gestione errori
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});

process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM ricevuto, chiusura...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('⚠️ SIGINT ricevuto, chiusura...');
  process.exit(0);
});

// Avvia se eseguito direttamente
if (require.main === module) {
  startProcessor().catch((error) => {
    console.error('❌ Errore fatale:', error);
    process.exit(1);
  });
}

module.exports = {
  startProcessor,
  processWithdrawal,
  checkDailyLimit
};
