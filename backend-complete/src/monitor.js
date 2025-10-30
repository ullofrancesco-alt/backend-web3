const { getWeb3, getContract } = require('./blockchain');
const { saveDeposit } = require('./database');

const POLLING_INTERVAL = 30000; // 30 secondi
const MIN_CONFIRMATIONS = parseInt(process.env.MIN_CONFIRMATIONS) || 12;

const TOKENS = {
  DEUR: {
    address: process.env.DEUR_TOKEN_ADDRESS,
    name: 'Digital EUR',
    symbol: 'DEUR'
  },
  DUSD: {
    address: process.env.DUSD_TOKEN_ADDRESS,
    name: 'Digital USD',
    symbol: 'DUSD'
  },
  DCNY: {
    address: process.env.DCNY_TOKEN_ADDRESS,
    name: 'Digital CNH',
    symbol: 'DCNY'
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
  console.log(`🔗 RPC: ${process.env.POLYGON_RPC_URL}`);
  console.log(`⏱️ Polling ogni ${POLLING_INTERVAL/1000}s`);
  
  isMonitoring = true;

  // Inizializza blocchi di partenza
  const web3 = getWeb3();
  const currentBlock = await web3.eth.getBlockNumber();
  
  for (const [key, token] of Object.entries(TOKENS)) {
    lastCheckedBlocks[token.address] = currentBlock;
    console.log(`👂 Monitor attivo per ${token.name} (${token.address})`);
  }

  // Avvia polling
  setInterval(async () => {
    try {
      await checkAllTokens();
    } catch (error) {
      console.error('❌ Errore nel monitor:', error.message);
      // Non crashare, continua a monitorare
    }
  }, POLLING_INTERVAL);

  console.log('✅ Monitor attivo e in ascolto...');
}

async function checkAllTokens() {
  const web3 = getWeb3();
  
  for (const [key, token] of Object.entries(TOKENS)) {
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

  // Cerca eventi Transfer verso il wallet piattaforma
  const events = await contract.getPastEvents('Transfer', {
    filter: { to: PLATFORM_WALLET },
    fromBlock: fromBlock,
    toBlock: currentBlock
  });

  if (events.length > 0) {
    console.log(`\n🔍 Trovati ${events.length} trasferimenti per ${token.name}`);
  }

  for (const event of events) {
    await processDeposit(web3, event, token, currentBlock);
  }

  lastCheckedBlocks[token.address] = currentBlock;
}

async function processDeposit(web3, event, token, currentBlock) {
  const { from, to, value } = event.returnValues;
  const txHash = event.transactionHash;
  const blockNumber = event.blockNumber;
  const confirmations = currentBlock - blockNumber;

  const amount = web3.utils.fromWei(value, 'ether');

  console.log(`\n💰 DEPOSITO RILEVATO:`);
  console.log(`   Token: ${token.name}`);
  console.log(`   From: ${from}`);
  console.log(`   Amount: ${amount}`);
  console.log(`   TX: ${txHash}`);
  console.log(`   Conferme: ${confirmations}/${MIN_CONFIRMATIONS}`);

  if (confirmations >= MIN_CONFIRMATIONS) {
    // Ottieni l'email dell'utente (TODO: implementare mapping wallet->email)
    // Per ora usiamo il from address come identificatore
    const userEmail = from.toLowerCase();

    console.log(`✅ Deposito confermato! Salvataggio...`);
    
    await saveDeposit({
      userEmail,
      userWalletAddress: from,
      amount: parseFloat(amount),
      currency: token.name,
      txHash,
      blockNumber,
      status: 'confirmed'
    });

    console.log(`✅ Deposito salvato per ${userEmail}`);
  } else {
    console.log(`⏳ In attesa di ${MIN_CONFIRMATIONS - confirmations} conferme...`);
  }
}

function stopMonitor() {
  isMonitoring = false;
  console.log('🛑 Monitor fermato');
}

module.exports = {
  startMonitor,
  stopMonitor
};
