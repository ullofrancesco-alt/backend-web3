const { getWeb3, getContract } = require('./blockchain');
const { saveDeposit } = require('./database');

const POLLING_INTERVAL = 30000; // 30 secondi
const MIN_CONFIRMATIONS = parseInt(process.env.MIN_CONFIRMATIONS) || 12;

const TOKENS = {
  DEUR: {
    address: process.env.DEUR_TOKEN_ADDRESS,
    name: 'Digital EUR'
  },
  DUSD: {
    address: process.env.DUSD_TOKEN_ADDRESS,
    name: 'Digital USD'
  },
  DCNY: {
    address: process.env.DCNY_TOKEN_ADDRESS,
    name: 'Digital CNH'
  }
};

const PLATFORM_WALLET = process.env.PLATFORM_WALLET_ADDRESS;

let lastCheckedBlocks = {};
let isMonitoring = false;

async function startMonitor() {
  if (isMonitoring) {
    console.log('⚠️ Monitor già attivo');
    return;
  }

  console.log('🚀 Avvio Blockchain Monitor...');
  console.log(`📍 Wallet piattaforma: ${PLATFORM_WALLET}`);
  console.log(`⏱️ Polling ogni ${POLLING_INTERVAL/1000}s\n`);
  
  isMonitoring = true;

  try {
    const web3 = getWeb3();
    const currentBlock = await web3.eth.getBlockNumber();
    
    for (const [key, token] of Object.entries(TOKENS)) {
      if (!token.address) continue;
      lastCheckedBlocks[token.address] = Number(currentBlock);
      console.log(`👂 Monitor ${token.name}: ${token.address}`);
    }
    
    console.log('\n✅ Monitor attivo!\n');
    
    // Primo check immediato
    setTimeout(checkAllTokens, 5000);
    
    // Poi ogni POLLING_INTERVAL
    setInterval(checkAllTokens, POLLING_INTERVAL);
    
  } catch (error) {
    console.error('❌ Errore avvio monitor:', error.message);
    isMonitoring = false;
  }
}

async function checkAllTokens() {
  const web3 = getWeb3();
  
  for (const [key, token] of Object.entries(TOKENS)) {
    if (!token.address) continue;
    
    try {
      await checkToken(web3, token);
    } catch (error) {
      console.error(`❌ Errore check ${token.name}:`, error.message);
    }
  }
}

async function checkToken(web3, token) {
  const contract = getContract(token.address);
  const currentBlock = await web3.eth.getBlockNumber();
  const fromBlock = lastCheckedBlocks[token.address] + 1;
  
  if (fromBlock > currentBlock) return;

  const events = await contract.getPastEvents('Transfer', {
    filter: { to: PLATFORM_WALLET },
    fromBlock: fromBlock,
    toBlock: currentBlock
  });

  if (events.length > 0) {
    console.log(`\n🔍 [${token.name}] Trovati ${events.length} trasferimenti\n`);
  }

  for (const event of events) {
    await processDeposit(web3, event, token, Number(currentBlock));
  }

  lastCheckedBlocks[token.address] = Number(currentBlock);
}

async function processDeposit(web3, event, token, currentBlock) {
  const { from, to, value } = event.returnValues;
  const txHash = event.transactionHash;
  const blockNumber = Number(event.blockNumber);
  const confirmations = currentBlock - blockNumber;

  const amount = web3.utils.fromWei(value, 'ether');

  console.log(`💰 DEPOSITO RILEVATO:`);
  console.log(`   Token: ${token.name}`);
  console.log(`   From: ${from}`);
  console.log(`   Amount: ${amount}`);
  console.log(`   TX: ${txHash}`);
  console.log(`   Conferme: ${confirmations}/${MIN_CONFIRMATIONS}\n`);

  if (confirmations >= MIN_CONFIRMATIONS) {
    const userEmail = from.toLowerCase();

    console.log(`✅ Deposito confermato! Salvataggio...`);
    
    try {
      await saveDeposit({
        userEmail,
        userWalletAddress: from,
        amount: parseFloat(amount),
        currency: token.name,
        txHash,
        blockNumber,
        status: 'confirmed'
      });

      console.log(`✅ Salvato per ${userEmail}\n`);
    } catch (error) {
      console.error(`❌ Errore salvataggio:`, error.message);
    }
  }
}

module.exports = {
  startMonitor
};
