const { Web3 } = require('web3');

const RPC_URL = process.env.POLYGON_RPC_URL;
const ERC20_ABI = [
  {
    "constant": true,
    "inputs": [{"name": "_owner", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"name": "balance", "type": "uint256"}],
    "type": "function"
  },
  {
    "constant": false,
    "inputs": [
      {"name": "_to", "type": "address"},
      {"name": "_value", "type": "uint256"}
    ],
    "name": "transfer",
    "outputs": [{"name": "", "type": "bool"}],
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "name": "from", "type": "address"},
      {"indexed": true, "name": "to", "type": "address"},
      {"indexed": false, "name": "value", "type": "uint256"}
    ],
    "name": "Transfer",
    "type": "event"
  }
];

let web3Instance = null;

function initWeb3() {
  if (!RPC_URL) {
    throw new Error('POLYGON_RPC_URL non configurato');
  }
  
  web3Instance = new Web3(new Web3.providers.HttpProvider(RPC_URL));
  console.log('✅ Web3 connesso a:', RPC_URL);
}

function getWeb3() {
  if (!web3Instance) {
    initWeb3();
  }
  return web3Instance;
}

function getContract(tokenAddress) {
  const web3 = getWeb3();
  return new web3.eth.Contract(ERC20_ABI, tokenAddress);
}

async function sendTokens(tokenAddress, toAddress, amount) {
  const web3 = getWeb3();
  const contract = getContract(tokenAddress);
  
  const privateKey = process.env.PLATFORM_WALLET_PRIVATE_KEY;
  const fromAddress = process.env.PLATFORM_WALLET_ADDRESS;
  
  if (!privateKey || !fromAddress) {
    throw new Error('Wallet credentials mancanti');
  }
  
  const amountWei = web3.utils.toWei(amount.toString(), 'ether');
  
  const tx = {
    from: fromAddress,
    to: tokenAddress,
    data: contract.methods.transfer(toAddress, amountWei).encodeABI(),
    gas: 100000,
    gasPrice: await web3.eth.getGasPrice()
  };
  
  const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
  const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
  
  return receipt.transactionHash;
}

module.exports = {
  initWeb3,
  getWeb3,
  getContract,
  sendTokens
};
