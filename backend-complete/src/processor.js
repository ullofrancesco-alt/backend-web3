const { getPendingWithdrawals, updateWithdrawalStatus } = require('./database');
const { sendTokens } = require('./blockchain');

const PROCESS_INTERVAL = 60000; // 60 secondi
const MAX_DAILY_WITHDRAWAL = parseFloat(process.env.MAX_DAILY_WITHDRAWAL) || 10000;

const TOKEN_ADDRESSES = {
  'Digital EUR': process.env.DEUR_TOKEN_ADDRESS,
  'Digital USD': process.env.DUSD_TOKEN_ADDRESS,
  'Digital CNH': process.env.DCNY_TOKEN_ADDRESS
};

let isProcessing = false;

async function startProcessor() {
  if (isProcessing) {
    console.log('⚠️ Processor già attivo');
    return;
  }

  console.log('🚀 Avvio Withdrawal Processor...');
  console.log(`⏱️ Controllo ogni ${PROCESS_INTERVAL/1000}s\n`);
  
  isProcessing = true;
  
  setInterval(processWithdrawals, PROCESS_INTERVAL);
  
  console.log('✅ Processor attivo!\n');
}

async function processWithdrawals() {
  try {
    const pending = await getPendingWithdrawals();
    
    if (pending.length === 0) return;
    
    console.log(`\n💸 ${pending.length} prelievi da processare\n`);
    
    for (const withdrawal of pending) {
      await processWithdrawal(withdrawal);
    }
    
  } catch (error) {
    console.error('❌ Errore processor:', error.message);
  }
}

async function processWithdrawal(withdrawal) {
  const { id, user_email, amount, currency, to_address } = withdrawal;
  
  console.log(`💳 Processamento prelievo #${id}`);
  console.log(`   User: ${user_email}`);
  console.log(`   Amount: ${amount} ${currency}`);
  console.log(`   To: ${to_address}`);
  
  try {
    const tokenAddress = TOKEN_ADDRESSES[currency];
    
    if (!tokenAddress) {
      throw new Error(`Token address non configurato per ${currency}`);
    }
    
    const txHash = await sendTokens(tokenAddress, to_address, amount);
    
    await updateWithdrawalStatus(id, 'completed', txHash);
    
    console.log(`✅ Prelievo completato! TX: ${txHash}\n`);
    
  } catch (error) {
    console.error(`❌ Errore prelievo #${id}:`, error.message);
    await updateWithdrawalStatus(id, 'failed', null);
  }
}

module.exports = {
  startProcessor
};
