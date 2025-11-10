#!/usr/bin/env node

const ethers = require('ethers');
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const ora = require('ora');
const cliProgress = require('cli-progress');
require('dotenv').config();

// Baca file konfigurasi
const rpcConfig = JSON.parse(fs.readFileSync('rpc.json', 'utf-8'));
const privateKeyList = fs.readFileSync('pk.txt', 'utf-8')
  .split('\n')
  .map(pk => pk.trim())
  .filter(pk => pk !== '');

// Baca file alamat penerima
let addressList = [];
try {
  addressList = fs.readFileSync('address.txt', 'utf-8')
    .split('\n')
    .map(addr => addr.trim())
    .filter(addr => addr !== '' && ethers.isAddress(addr));
  console.log(chalk.green(`✅ Ditemukan ${addressList.length} alamat penerima di address.txt`));
} catch (error) {
  console.log(chalk.yellow('⚠️ File address.txt tidak ditemukan atau kosong'));
}

// Fungsi untuk memotong alamat
function shortenAddress(address) {
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

// Fungsi untuk mendapatkan emoticon jaringan
function getNetworkEmoji(chainId) {
  switch(chainId) {
    case 1: return '💎'; // Ethereum
    case 56: return '🟡'; // BSC
    case 137: return '🟣'; // Polygon
    case 43114: return '❄️'; // Avalanche
    case 250: return '👻'; // Fantom
    case 42161: return '🔷'; // Arbitrum
    case 10: return '🔴'; // Optimism
    case 100: return '🟢'; // Gnosis Chain
    default: return '⚪';
  }
}

// Fungsi untuk menampilkan pesan dengan warna dan emoticon
const log = {
  header: (msg) => console.log(chalk.bold.black.bgYellow(`\n 🔖 ${msg} 🔖 \n`)),
  info: (msg) => console.log(chalk.blue(`📋 ${msg}`)),
  success: (msg) => console.log(chalk.green(`✅ ${msg}`)),
  warning: (msg) => console.log(chalk.yellow(`⚠️ ${msg}`)),
  error: (msg) => console.log(chalk.red(`❌ ${msg}`)),
  big: (msg) => console.log(chalk.bold.white(`\n🚀 ${msg} 🚀\n`)),
  step: (msg) => console.log(chalk.cyan(`🔄 ${msg}`)),
  tx: (msg) => console.log(chalk.magenta(`🔗 ${msg}`)),
  explorer: (hash, explorer) => console.log(chalk.blue(`🌐 Explorer: ${explorer}/tx/${hash}`))
};

// Fungsi untuk mendapatkan provider
function getProvider(rpcUrl) {
  return new ethers.JsonRpcProvider(rpcUrl);
}

// Fungsi untuk mendapatkan wallet
function getWallet(privateKey, provider) {
  return new ethers.Wallet(privateKey, provider);
}

// Fungsi untuk mengirim native token dengan retry
async function sendNativeWithRetry(wallet, to, amount, explorer, maxRetries = 3) {
  let nonce = await wallet.getNonce();
  let gasPrice = await wallet.provider.getFeeData().then(fd => fd.gasPrice);
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const spinner = ora('⏳ Mengirim transaksi...').start();
      
      const tx = {
        to: to,
        value: amount,
        nonce: nonce,
        gasPrice: gasPrice,
        gasLimit: 21000
      };

      const txResponse = await wallet.sendTransaction(tx);
      spinner.succeed(`✅ Transaksi terkirim: ${txResponse.hash}`);
      
      log.tx(`HASH: ${txResponse.hash}`);
      log.explorer(txResponse.hash, explorer);
      
      return txResponse;
    } catch (error) {
      if (error.message.includes('nonce too low')) {
        log.warning(`Nonce terlalu rendah, mencoba lagi... (${i + 1}/${maxRetries})`);
        nonce = await wallet.getNonce();
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else if (error.message.includes('replacement fee too low')) {
        log.warning(`Fee terlalu rendah, menaikkan gas price... (${i + 1}/${maxRetries})`);
        gasPrice = (gasPrice * ethers.toBigInt(110)) / ethers.toBigInt(100);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries reached');
}

// Fungsi untuk mengirim token dengan retry
async function sendTokenWithRetry(wallet, tokenContract, to, amount, explorer, maxRetries = 3) {
  let nonce = await wallet.getNonce();
  let gasPrice = await wallet.provider.getFeeData().then(fd => fd.gasPrice);
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const spinner = ora('⏳ Mengirim transaksi...').start();
      
      const tx = await tokenContract.transfer.populateTransaction(to, amount);
      tx.nonce = nonce;
      tx.gasPrice = gasPrice;
      tx.gasLimit = 100000;

      const txResponse = await wallet.sendTransaction(tx);
      spinner.succeed(`✅ Transaksi terkirim: ${txResponse.hash}`);
      
      log.tx(`HASH: ${txResponse.hash}`);
      log.explorer(txResponse.hash, explorer);
      
      return txResponse;
    } catch (error) {
      if (error.message.includes('nonce too low')) {
        log.warning(`Nonce terlalu rendah, mencoba lagi... (${i + 1}/${maxRetries})`);
        nonce = await wallet.getNonce();
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else if (error.message.includes('replacement fee too low')) {
        log.warning(`Fee terlalu rendah, menaikkan gas price... (${i + 1}/${maxRetries})`);
        gasPrice = (gasPrice * ethers.toBigInt(110)) / ethers.toBigInt(100);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries reached');
}

// Fungsi untuk preview transaksi
async function previewTransactions(transactions, nativeSymbol) {
  log.header('📋 PREVIEW TRANSAKSI');
  let totalGas = ethers.toBigInt(0);
  
  console.log(chalk.gray('='.repeat(80)));
  
  for (const tx of transactions) {
    console.log(chalk.white(`DARI     : ${shortenAddress(tx.from)}`));
    console.log(chalk.white(`KE       : ${shortenAddress(tx.to)}`));
    const decimals = tx.decimals || 18;
    console.log(chalk.white(`JUMLAH   : ${ethers.formatUnits(tx.amount, decimals)} ${tx.symbol}`));
    console.log(chalk.white(`GAS      : ${tx.gasLimit} units`));
    console.log(chalk.white(`GAS PRICE: ${ethers.formatUnits(tx.gasPrice, 'gwei')} Gwei`));
    console.log(chalk.gray('-'.repeat(80)));
    totalGas += ethers.toBigInt(tx.gasLimit) * ethers.toBigInt(tx.gasPrice);
  }
  
  console.log(chalk.yellow(`💰 TOTAL ESTIMASI GAS FEE: ${ethers.formatEther(totalGas)} ${nativeSymbol}`));
  console.log(chalk.gray('='.repeat(80)));
}

// Fungsi untuk menampilkan menu jaringan
async function selectNetwork() {
  console.log(chalk.bold.white('\n🌐 PILIH JARINGAN:'));
  rpcConfig.forEach((net, index) => {
    const emoji = getNetworkEmoji(net.chainId);
    console.log(chalk.white(`   ${index + 1}. ${emoji} ${net.name} (Chain ID: ${net.chainId})`));
  });
  
  const { networkIndex } = await inquirer.prompt([
    {
      type: 'number',
      name: 'networkIndex',
      message: chalk.bold.white('MASUKKAN NOMOR JARINGAN:'),
      validate: input => {
        const num = parseInt(input);
        return num >= 1 && num <= rpcConfig.length || '❌ Nomor tidak valid!';
      }
    }
  ]);
  
  return rpcConfig[networkIndex - 1];
}

// Fungsi untuk menampilkan menu mode
async function selectMode(title, options) {
  console.log(chalk.bold.white(`\n${title}:`));
  options.forEach((option, index) => {
    console.log(chalk.white(`   ${index + 1}. ${option}`));
  });
  
  const { optionIndex } = await inquirer.prompt([
    {
      type: 'number',
      name: 'optionIndex',
      message: chalk.bold.white('MASUKKAN NOMOR PILIHAN:'),
      validate: input => {
        const num = parseInt(input);
        return num >= 1 && num <= options.length || '❌ Nomor tidak valid!';
      }
    }
  ]);
  
  return optionIndex - 1;
}

// Fungsi utama
async function main() {
  try {
    log.big('🚀 MULTI-CHAIN TOKEN SENDER 🚀');
    console.log(chalk.bold.blue(`🔑 DITEMUKAN ${privateKeyList.length} PRIVATE KEY DI pk.txt`));
    
    // Pilih jaringan
    const network = await selectNetwork();
    const provider = getProvider(network.rpcUrl || network.endpoint);
    const { name, chainId, explorer } = network;
    const emoji = getNetworkEmoji(chainId);
    
    // Dapatkan simbol native token dari konfigurasi atau default
    const symbol = network.symbol || 'BNB';
    
    log.header(`${emoji} JARINGAN: ${name} (${symbol})`);

    // Pilih opsi utama
    const mainOptions = [
      '💰 KIRIM TOKEN (BEP20/ERC20)',
      '💰 KIRIM NATIVE TOKEN'
    ];
    const mainOptionIndex = await selectMode('💫 PILIH MODE', mainOptions);
    const mainOption = mainOptionIndex === 0 ? 'token' : 'native';

    if (mainOption === 'token') {
      // Pilih sub opsi token
      const tokenOptions = [
        '📤 SATU ADDRESS → BANYAK ADDRESS',
        '📥 BANYAK ADDRESS → SATU ADDRESS'
      ];
      const tokenOptionIndex = await selectMode('📤 PILIH MODE PENGIRIMAN TOKEN', tokenOptions);
      const tokenOption = tokenOptionIndex === 0 ? 'multi' : 'single';

      // Input token contract
      const { tokenAddress } = await inquirer.prompt([
        {
          type: 'input',
          name: 'tokenAddress',
          message: chalk.bold.white('📝 MASUKKAN ALAMAT KONTRAK TOKEN:'),
          validate: input => ethers.isAddress(input) || '❌ Alamat tidak valid!'
        }
      ]);

      const tokenContract = new ethers.Contract(tokenAddress, [
        'function transfer(address to, uint amount) returns (bool)',
        'function balanceOf(address owner) view returns (uint)',
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)'
      ], provider);

      const tokenSymbol = await tokenContract.symbol();
      const tokenDecimals = await tokenContract.decimals();
      
      log.header(`🪙 TOKEN: ${tokenSymbol}`);

      if (tokenOption === 'multi') {
        // Kirim token ke banyak address
        console.log(chalk.cyan('\n📤 Mode: Satu Address → Banyak Address'));
        
        const { senderPk } = await inquirer.prompt([
          {
            type: 'password',
            name: 'senderPk',
            message: chalk.bold.white('🔑 MASUKKAN PRIVATE KEY PENGIRIM (atau tekan enter untuk .env):'),
            default: process.env.PRIVATE_KEY || '',
            mask: '*'
          }
        ]);

        const wallet = getWallet(senderPk, provider);
        const senderAddress = await wallet.getAddress();
        
        console.log(chalk.white(`👤 Pengirim: ${shortenAddress(senderAddress)}`));

        // Gunakan alamat dari file address.txt
        if (addressList.length === 0) {
          throw new Error('❌ Tidak ada alamat penerima yang valid di address.txt');
        }
        
        const recipients = addressList;
        console.log(chalk.white(`👥 Jumlah Penerima: ${recipients.length}`));
        
        // Input amount
        const amountOptions = [
          '🔄 Kirim Semua Saldo',
          '💰 Tentukan nominal'
        ];
        const amountOptionIndex = await selectMode('💸 PILIH JUMLAH', amountOptions);
        const amountOption = amountOptionIndex === 0 ? 'all' : 'fixed';

        let amountPerRecipient;
        if (amountOption === 'fixed') {
          const { amountInput } = await inquirer.prompt([
            {
              type: 'input',
              name: 'amountInput',
              message: chalk.bold.white(`💰 MASUKKAN JUMLAH ${tokenSymbol} PER PENERIMA:`),
              validate: input => !isNaN(input) && parseFloat(input) > 0 || '❌ Jumlah tidak valid!'
            }
          ]);
          amountPerRecipient = ethers.parseUnits(amountInput, tokenDecimals);
        } else {
          // Hitung saldo per penerima
          const balance = await tokenContract.balanceOf(senderAddress);
          amountPerRecipient = balance / ethers.toBigInt(recipients.length);
          console.log(chalk.white(`💱 Saldo per penerima: ${ethers.formatUnits(amountPerRecipient, tokenDecimals)} ${tokenSymbol}`));
        }

        const totalAmount = amountPerRecipient * ethers.toBigInt(recipients.length);

        // Cek saldo
        const balance = await tokenContract.balanceOf(senderAddress);
        if (balance < totalAmount) {
          throw new Error(`❌ Saldo tidak cukup! Dibutuhkan: ${ethers.formatUnits(totalAmount, tokenDecimals)} ${tokenSymbol}, Tersedia: ${ethers.formatUnits(balance, tokenDecimals)} ${tokenSymbol}`);
        }

        // Prepare transactions
        const transactions = [];
        for (const recipient of recipients) {
          transactions.push({
            from: senderAddress,
            to: recipient,
            amount: amountPerRecipient,
            symbol: tokenSymbol,
            decimals: tokenDecimals,
            gasLimit: 100000,
            gasPrice: await provider.getFeeData().then(fd => fd.gasPrice)
          });
        }

        // Preview
        await previewTransactions(transactions, symbol);

        // Konfirmasi
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: chalk.bold.white('❓ LANJUTKAN TRANSAKSI?'),
            default: false
          }
        ]);

        if (confirm) {
          log.header('🚀 MEMULAI PENGIRIMAN TOKEN');
          
          // Create a progress bar
          const progressBar = new cliProgress.SingleBar({
            format: '📤 Progress |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} Transactions',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
          });
          
          progressBar.start(transactions.length, 0);
          
          for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            console.log(chalk.cyan(`\n🔄 Eksekusi ${i+1}/${transactions.length}: ${shortenAddress(tx.from)} → ${shortenAddress(tx.to)}`));
            
            try {
              await sendTokenWithRetry(wallet, tokenContract, tx.to, tx.amount, explorer);
              log.success(`✅ BERHASIL: ${ethers.formatUnits(tx.amount, tokenDecimals)} ${tokenSymbol} → ${shortenAddress(tx.to)}`);
              progressBar.update(i + 1);
            } catch (error) {
              log.error(`❌ GAGAL: ${error.message}`);
            }
          }
          
          progressBar.stop();
          log.big('✅ SEMUA TRANSAKSI SELESAI');
        } else {
          log.warning('⚠️ Transaksi dibatalkan');
        }
      } else {
        // Kirim token ke satu address dari banyak wallet
        console.log(chalk.cyan('\n📥 Mode: Banyak Address → Satu Address'));
        
        const { recipientAddress } = await inquirer.prompt([
          {
            type: 'input',
            name: 'recipientAddress',
            message: chalk.bold.white('📝 MASUKKAN ALAMAT PENERIMA:'),
            validate: input => ethers.isAddress(input) || '❌ Alamat tidak valid!'
          }
        ]);
        
        console.log(chalk.white(`👤 Penerima: ${shortenAddress(recipientAddress)}`));

        const amountOptions = [
          '🔄 Kirim Semua Saldo',
          '💰 Tentukan nominal'
        ];
        const amountOptionIndex = await selectMode('💸 PILIH JUMLAH', amountOptions);
        const amountOption = amountOptionIndex === 0 ? 'all' : 'fixed';

        let amountPerWallet;
        if (amountOption === 'fixed') {
          const { amountInput } = await inquirer.prompt([
            {
              type: 'input',
              name: 'amountInput',
              message: chalk.bold.white(`💰 MASUKKAN JUMLAH ${tokenSymbol} PER WALLET:`),
              validate: input => !isNaN(input) && parseFloat(input) > 0 || '❌ Jumlah tidak valid!'
            }
          ]);
          amountPerWallet = ethers.parseUnits(amountInput, tokenDecimals);
        }

        // Prepare transactions
        const transactions = [];
        console.log(chalk.white(`🔄 Memproses ${privateKeyList.length} wallet...`));
        console.log(chalk.gray('-'.repeat(50)));
        
        for (let i = 0; i < privateKeyList.length; i++) {
          const pk = privateKeyList[i];
          try {
            const wallet = getWallet(pk, provider);
            const senderAddress = await wallet.getAddress();
            console.log(chalk.white(`🔄 Memproses Wallet ${i+1}/${privateKeyList.length}: ${shortenAddress(senderAddress)}`));
            
            let amount;
            if (amountOption === 'all') {
              amount = await tokenContract.balanceOf(senderAddress);
              const formattedAmount = ethers.formatUnits(amount, tokenDecimals);
              console.log(chalk.white(`💰 Saldo: ${formattedAmount} ${tokenSymbol}`));
            } else {
              amount = amountPerWallet;
            }

            if (amount > 0) {
              transactions.push({
                from: senderAddress,
                to: recipientAddress,
                amount: amount,
                symbol: tokenSymbol,
                decimals: tokenDecimals,
                gasLimit: 100000,
                gasPrice: await provider.getFeeData().then(fd => fd.gasPrice)
              });
              console.log(chalk.green(`✅ Transaksi ditambahkan dari ${shortenAddress(senderAddress)}`));
            } else {
              console.log(chalk.yellow(`⚠️ Melewati ${shortenAddress(senderAddress)} - saldo tidak cukup`));
            }
          } catch (error) {
            console.log(chalk.red(`❌ Error memproses wallet ${i+1}: ${error.message}`));
          }
        }

        console.log(chalk.gray('-'.repeat(50)));
        console.log(chalk.white(`📊 Total transaksi: ${transactions.length}`));

        if (transactions.length === 0) {
          throw new Error('❌ Tidak ada wallet dengan saldo token yang cukup');
        }

        // Preview
        await previewTransactions(transactions, symbol);

        // Konfirmasi
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: chalk.bold.white('❓ LANJUTKAN TRANSAKSI?'),
            default: false
          }
        ]);

        if (confirm) {
          log.header('🚀 MEMULAI PENGIRIMAN TOKEN');
          
          // Create a progress bar
          const progressBar = new cliProgress.SingleBar({
            format: '📤 Progress |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} Transactions',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
          });
          
          progressBar.start(transactions.length, 0);
          
          for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            console.log(chalk.cyan(`\n🔄 Eksekusi ${i+1}/${transactions.length}: ${shortenAddress(tx.from)} → ${shortenAddress(tx.to)}`));
            
            try {
              const wallet = getWallet(privateKeyList.find(pk => {
                const w = getWallet(pk, provider);
                return w.address === tx.from;
              }), provider);
              
              await sendTokenWithRetry(wallet, tokenContract, tx.to, tx.amount, explorer);
              log.success(`✅ BERHASIL: ${ethers.formatUnits(tx.amount, tokenDecimals)} ${tokenSymbol} → ${shortenAddress(tx.to)}`);
              progressBar.update(i + 1);
            } catch (error) {
              log.error(`❌ GAGAL: ${error.message}`);
            }
          }
          
          progressBar.stop();
          log.big('✅ SEMUA TRANSAKSI SELESAI');
        } else {
          log.warning('⚠️ Transaksi dibatalkan');
        }
      }
    } else {
      // Opsi native token
      const nativeOptions = [
        '📤 SATU ADDRESS → BANYAK ADDRESS',
        '📥 BANYAK ADDRESS → SATU ADDRESS'
      ];
      const nativeOptionIndex = await selectMode('📤 PILIH MODE PENGIRIMAN NATIVE TOKEN', nativeOptions);
      const nativeOption = nativeOptionIndex === 0 ? 'multi' : 'single';

      if (nativeOption === 'multi') {
        // Kirim native token ke banyak address
        console.log(chalk.cyan('\n📤 Mode: Satu Address → Banyak Address'));
        
        const { senderPk } = await inquirer.prompt([
          {
            type: 'password',
            name: 'senderPk',
            message: chalk.bold.white('🔑 MASUKKAN PRIVATE KEY PENGIRIM (atau tekan enter untuk .env):'),
            default: process.env.PRIVATE_KEY || '',
            mask: '*'
          }
        ]);

        const wallet = getWallet(senderPk, provider);
        const senderAddress = await wallet.getAddress();
        
        console.log(chalk.white(`👤 Pengirim: ${shortenAddress(senderAddress)}`));

        // Gunakan alamat dari file address.txt
        if (addressList.length === 0) {
          throw new Error('❌ Tidak ada alamat penerima yang valid di address.txt');
        }
        
        const recipients = addressList;
        console.log(chalk.white(`👥 Jumlah Penerima: ${recipients.length}`));
        
        // Input amount
        const amountOptions = [
          '🔄 Kirim Semua Saldo',
          '💰 Tentukan nominal'
        ];
        const amountOptionIndex = await selectMode('💸 PILIH JUMLAH', amountOptions);
        const amountOption = amountOptionIndex === 0 ? 'all' : 'fixed';

        let amountPerRecipient;
        if (amountOption === 'fixed') {
          const { amountInput } = await inquirer.prompt([
            {
              type: 'input',
              name: 'amountInput',
              message: chalk.bold.white(`💰 MASUKKAN JUMLAH ${symbol} PER PENERIMA:`),
              validate: input => !isNaN(input) && parseFloat(input) > 0 || '❌ Jumlah tidak valid!'
            }
          ]);
          amountPerRecipient = ethers.parseEther(amountInput);
        } else {
          // Hitung saldo per penerima
          const balance = await provider.getBalance(senderAddress);
          amountPerRecipient = balance / ethers.toBigInt(recipients.length);
          console.log(chalk.white(`💱 Saldo per penerima: ${ethers.formatEther(amountPerRecipient)} ${symbol}`));
        }

        const totalAmount = amountPerRecipient * ethers.toBigInt(recipients.length);

        // Cek saldo
        const balance = await provider.getBalance(senderAddress);
        if (balance < totalAmount) {
          throw new Error(`❌ Saldo tidak cukup! Dibutuhkan: ${ethers.formatEther(totalAmount)} ${symbol}, Tersedia: ${ethers.formatEther(balance)} ${symbol}`);
        }

        // Prepare transactions
        const transactions = [];
        for (const recipient of recipients) {
          transactions.push({
            from: senderAddress,
            to: recipient,
            amount: amountPerRecipient,
            symbol: symbol,
            decimals: 18,
            gasLimit: 21000,
            gasPrice: await provider.getFeeData().then(fd => fd.gasPrice)
          });
        }

        // Preview
        await previewTransactions(transactions, symbol);

        // Konfirmasi
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: chalk.bold.white('❓ LANJUTKAN TRANSAKSI?'),
            default: false
          }
        ]);

        if (confirm) {
          log.header('🚀 MEMULAI PENGIRIMAN NATIVE TOKEN');
          
          // Create a progress bar
          const progressBar = new cliProgress.SingleBar({
            format: '📤 Progress |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} Transactions',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
          });
          
          progressBar.start(transactions.length, 0);
          
          for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            console.log(chalk.cyan(`\n🔄 Eksekusi ${i+1}/${transactions.length}: ${shortenAddress(tx.from)} → ${shortenAddress(tx.to)}`));
            
            try {
              await sendNativeWithRetry(wallet, tx.to, tx.amount, explorer);
              log.success(`✅ BERHASIL: ${ethers.formatEther(tx.amount)} ${symbol} → ${shortenAddress(tx.to)}`);
              progressBar.update(i + 1);
            } catch (error) {
              log.error(`❌ GAGAL: ${error.message}`);
            }
          }
          
          progressBar.stop();
          log.big('✅ SEMUA TRANSAKSI SELESAI');
        } else {
          log.warning('⚠️ Transaksi dibatalkan');
        }
      } else {
        // Kirim native token ke satu address dari banyak wallet
        console.log(chalk.cyan('\n📥 Mode: Banyak Address → Satu Address'));
        
        const { recipientAddress } = await inquirer.prompt([
          {
            type: 'input',
            name: 'recipientAddress',
            message: chalk.bold.white('📝 MASUKKAN ALAMAT PENERIMA:'),
            validate: input => ethers.isAddress(input) || '❌ Alamat tidak valid!'
          }
        ]);
        
        console.log(chalk.white(`👤 Penerima: ${shortenAddress(recipientAddress)}`));

        const amountOptions = [
          '🔄 Kirim Semua Saldo',
          '💰 Tentukan nominal'
        ];
        const amountOptionIndex = await selectMode('💸 PILIH JUMLAH', amountOptions);
        const amountOption = amountOptionIndex === 0 ? 'all' : 'fixed';

        let amountPerWallet;
        if (amountOption === 'fixed') {
          const { amountInput } = await inquirer.prompt([
            {
              type: 'input',
              name: 'amountInput',
              message: chalk.bold.white(`💰 MASUKKAN JUMLAH ${symbol} PER WALLET:`),
              validate: input => !isNaN(input) && parseFloat(input) > 0 || '❌ Jumlah tidak valid!'
            }
          ]);
          amountPerWallet = ethers.parseEther(amountInput);
        }

        // Prepare transactions
        const transactions = [];
        console.log(chalk.white(`🔄 Memproses ${privateKeyList.length} wallet...`));
        console.log(chalk.gray('-'.repeat(50)));
        
        for (let i = 0; i < privateKeyList.length; i++) {
          const pk = privateKeyList[i];
          try {
            const wallet = getWallet(pk, provider);
            const senderAddress = await wallet.getAddress();
            console.log(chalk.white(`🔄 Memproses Wallet ${i+1}/${privateKeyList.length}: ${shortenAddress(senderAddress)}`));
            
            let amount;
            if (amountOption === 'all') {
              const balance = await provider.getBalance(senderAddress);
              // Kurangi biaya gas
              const gasPrice = await provider.getFeeData().then(fd => fd.gasPrice);
              const gasFee = gasPrice * ethers.toBigInt(21000);
              amount = balance - gasFee;
              const formattedAmount = ethers.formatEther(amount);
              console.log(chalk.white(`💰 Saldo yang akan dikirim: ${formattedAmount} ${symbol}`));
            } else {
              amount = amountPerWallet;
            }

            if (amount > 0) {
              transactions.push({
                from: senderAddress,
                to: recipientAddress,
                amount: amount,
                symbol: symbol,
                decimals: 18,
                gasLimit: 21000,
                gasPrice: await provider.getFeeData().then(fd => fd.gasPrice)
              });
              console.log(chalk.green(`✅ Transaksi ditambahkan dari ${shortenAddress(senderAddress)}`));
            } else {
              console.log(chalk.yellow(`⚠️ Melewati ${shortenAddress(senderAddress)} - saldo tidak cukup`));
            }
          } catch (error) {
            console.log(chalk.red(`❌ Error memproses wallet ${i+1}: ${error.message}`));
          }
        }

        console.log(chalk.gray('-'.repeat(50)));
        console.log(chalk.white(`📊 Total transaksi: ${transactions.length}`));

        if (transactions.length === 0) {
          throw new Error('❌ Tidak ada wallet dengan saldo yang cukup');
        }

        // Preview
        await previewTransactions(transactions, symbol);

        // Konfirmasi
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: chalk.bold.white('❓ LANJUTKAN TRANSAKSI?'),
            default: false
          }
        ]);

        if (confirm) {
          log.header('🚀 MEMULAI PENGIRIMAN NATIVE TOKEN');
          
          // Create a progress bar
          const progressBar = new cliProgress.SingleBar({
            format: '📤 Progress |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} Transactions',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
          });
          
          progressBar.start(transactions.length, 0);
          
          for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            console.log(chalk.cyan(`\n🔄 Eksekusi ${i+1}/${transactions.length}: ${shortenAddress(tx.from)} → ${shortenAddress(tx.to)}`));
            
            try {
              const wallet = getWallet(privateKeyList.find(pk => {
                const w = getWallet(pk, provider);
                return w.address === tx.from;
              }), provider);
              
              await sendNativeWithRetry(wallet, tx.to, tx.amount, explorer);
              log.success(`✅ BERHASIL: ${ethers.formatEther(tx.amount)} ${symbol} → ${shortenAddress(tx.to)}`);
              progressBar.update(i + 1);
            } catch (error) {
              log.error(`❌ GAGAL: ${error.message}`);
            }
          }
          
          progressBar.stop();
          log.big('✅ SEMUA TRANSAKSI SELESAI');
        } else {
          log.warning('⚠️ Transaksi dibatalkan');
        }
      }
    }
  } catch (error) {
    log.error(`❌ ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
