const express = require('express');
const Web3 = require('web3').default;
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const web3 = new Web3(process.env.POLYGON_RPC_URL);

// ABI minimo ERC20 per leggere saldo
const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
];

const TOKENS = {
  'Digital EUR': {
    address: process.env.DEUR_TOKEN_ADDRESS,
    symbol: 'DEUR',
    contract: new web3.eth.Contract(ERC20_ABI, process.env.DEUR_TOKEN_ADDRESS)
  },
  'Digital USD': {
    address: process.env.DUSD_TOKEN_ADDRESS,
    symbol: 'DUSD',
    contract: new web3.eth.Contract(ERC20_ABI, process.env.DUSD_TOKEN_ADDRESS)
  },
  'Digital CNH': {
    address: process.env.DCNY_TOKEN_ADDRESS,
    symbol: 'DCNY',
    contract: new web3.eth.Contract(ERC20_ABI, process.env.DCNY_TOKEN_ADDRESS)
  }
};

// ENDPOINT: Leggi saldo MetaMask di un utente
app.post('/api/check-balance', async (req, res) => {
  try {
    const { walletAddress, currency } = req.body;

    if (!walletAddress || !currency) {
      return res.status(400).json({ error: 'Wallet address e currency richiesti' });
    }

    const tokenInfo = TOKENS[currency];
    if (!tokenInfo) {
      return res.status(400).json({ error: 'Valuta non supportata' });
    }

    // Leggi saldo blockchain
    const balance = await tokenInfo.contract.methods.balanceOf(walletAddress).call();
    const balanceFormatted = parseFloat(web3.utils.fromWei(balance, 'ether'));

    res.json({
      walletAddress,
      currency,
      balance: balanceFormatted,
      tokenAddress: tokenInfo.address
    });

  } catch (error) {
    console.error('Errore check balance:', error);
    res.status(500).json({ error: error.message });
  }
});

// ENDPOINT: Sincronizza saldo con base44
app.post('/api/sync-balance', async (req, res) => {
  try {
    const { userEmail, walletAddress, currency } = req.body;

    if (!userEmail || !walletAddress || !currency) {
      return res.status(400).json({ error: 'Parametri mancanti' });
    }

    const tokenInfo = TOKENS[currency];
    if (!tokenInfo) {
      return res.status(400).json({ error: 'Valuta non supportata' });
    }

    // 1. Leggi saldo MetaMask
    const balance = await tokenInfo.contract.methods.balanceOf(walletAddress).call();
    const balanceFormatted = parseFloat(web3.utils.fromWei(balance, 'ether'));

    // 2. Leggi saldo attuale base44
    const currentUserData = await axios.get(
      `${process.env.BASE44_API_URL}/users/${userEmail}`,
      { headers: { 'Authorization': `Bearer ${process.env.BASE44_API_KEY}` }}
    );
    
    const currentBalance = currentUserData.data.digital_currency_balance || 0;

    // 3. Calcola differenza
    const difference = balanceFormatted - currentBalance;

    if (difference > 0) {
      // Accredita differenza
      await axios.patch(
        `${process.env.BASE44_API_URL}/users/${userEmail}`,
        { digital_currency_balance: balanceFormatted },
        { headers: { 'Authorization': `Bearer ${process.env.BASE44_API_KEY}` }}
      );

      // Crea transazione
      await axios.post(
        `${process.env.BASE44_API_URL}/entities/Transaction`,
        {
          user_email: userEmail,
          type: 'purchase',
          amount: difference,
          currency: currency,
          status: 'completed',
          description: `Sincronizzazione wallet - Acquisto ${difference.toFixed(2)} ${currency}`
        },
        { headers: { 'Authorization': `Bearer ${process.env.BASE44_API_KEY}` }}
      );

      res.json({
        success: true,
        message: `Accreditati ${difference.toFixed(2)} ${currency}`,
        newBalance: balanceFormatted
      });
    } else {
      res.json({
        success: true,
        message: 'Saldo già sincronizzato',
        balance: balanceFormatted
      });
    }

  } catch (error) {
    console.error('Errore sync balance:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend Web3 attivo su porta ${PORT}`);
});
