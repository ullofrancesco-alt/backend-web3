const Web3 = require('web3').default;
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();

const web3 = new Web3(process.env.POLYGON_RPC_URL);

const ERC20_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' }
    ],
    name: 'Transfer',
    type: 'event'
  }
];

const TOKENS = [
  { name: 'Digital EUR', address: process.env.DEUR_TOKEN_ADDRESS },
  { name: 'Digital USD', address: process.env.DUSD_TOKEN_ADDRESS },
  { name: 'Digital CNH', address: process.env.DCNY_TOKEN_ADDRESS }
];

let lastCheckedBlock = {};

async function monitorTransfers() {
  console.log('🔍 Controllo nuove transazioni...');

  for (const token of TOKENS) {
    try {
      const contract = new web3.eth.Contract(ERC20_ABI, token.address);
      const currentBlock = await web3.eth.getBlockNumber();
      const fromBlock = lastCheckedBlock[token.address] || (currentBlock - BigInt(1000));

      // Leggi eventi Transfer
      const events = await contract.getPastEvents('Transfer', {
        fromBlock: fromBlock.toString(),
        toBlock: 'latest'
      });

      console.log(`📊 ${token.name}: ${events.length} trasferimenti trovati`);

      for (const event of events) {
        const { from, to, value } = event.returnValues;
        const amount = parseFloat(web3.utils.fromWei(value, 'ether'));

        console.log(`💰 Transfer: ${amount} ${token.name} da ${from} a ${to}`);

        // Qui puoi chiamare base44 API per accreditare
        // Se 'to' è un wallet collegato a un utente
        await notifyPurchase(to, amount, token.name);
      }

      lastCheckedBlock[token.address] = currentBlock;

    } catch (error) {
      console.error(`Errore monitoraggio ${token.name}:`, error.message);
    }
  }
}

async function notifyPurchase(walletAddress, amount, currency) {
  try {
    // Cerca utente con questo wallet
    const users = await axios.get(
      `${process.env.BASE44_API_URL}/entities/User?metamask_address=${walletAddress}`,
      { headers: { 'Authorization': `Bearer ${process.env.BASE44_API_KEY}` }}
    );

    if (users.data.length > 0) {
      const user = users.data[0];
      
      // Accredita saldo
      const newBalance = (user.digital_currency_balance || 0) + amount;
      
      await axios.patch(
        `${process.env.BASE44_API_URL}/users/${user.email}`,
        { digital_currency_balance: newBalance },
        { headers: { 'Authorization': `Bearer ${process.env.BASE44_API_KEY}` }}
      );

      console.log(`✅ Accreditati ${amount} ${currency} a ${user.email}`);
    }
  } catch (error) {
    console.error('Errore notifica acquisto:', error.message);
  }
}

// Esegui ogni 30 secondi
cron.schedule(`*/${process.env.CHECK_INTERVAL || 30} * * * * *`, monitorTransfers);

console.log('🤖 Monitor Web3 avviato');
monitorTransfers(); // Prima esecuzione immediata
