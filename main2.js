#!/usr/bin/env node

const ethers = require('ethers');
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const ora = require('ora');
require('dotenv').config();

// Baca file konfigurasi
const rpcConfig = JSON.parse(fs.readFileSync('rpc.json', 'utf-8'));
const privateKeyList = fs.readFileSync('pk.txt', 'utf-8')
  .split('\n')
  .map(pk => pk.trim())
  .filter(pk => pk !== '');

// Fungsi untuk menampilkan pesan dengan warna dan ukuran huruf
const log = {
  header: (msg) => console.log(chalk.bold.black.bgYellow(`\n ${msg} \n`)),
  info: (msg) => console.log(chalk.blue(`📋 ${msg}`)),
  success: (msg) => console.log(chalk.green(`✅ ${msg}`)),
  warning: (msg) => console.log(chalk.yellow(`⚠️ ${msg}`)),
  error: (msg) => console.log(chalk.red(`❌ ${msg}`)),
  big: (msg) => console.log(chalk.bold.white(`\n${msg}\n`)),
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
      const tx = {
        to: to,
        value: amount,
        nonce: nonce,
        gasPrice: gasPrice,
        gasLimit: 21000
      };

      const txResponse = await wallet.sendTransaction(tx);
      return txResponse;
    } catch (error) {
      if (error.message.includes('nonce too low')) {
        nonce = await wallet.getNonce();
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else if (error.message.includes('replacement fee too low')) {
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
      const tx = await tokenContract.transfer.populateTransaction(to, amount);
      tx.nonce = nonce;
      tx.gasPrice = gasPrice;
      tx.gasLimit = 100000;

      const txResponse = await wallet.sendTransaction(tx);
      return txResponse;
    } catch (error) {
      if (error.message.includes('nonce too low')) {
        nonce = await wallet.getNonce();
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else if (error.message.includes('replacement fee too low')) {
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
  log.header('PREVIEW TRANSAKSI');
  let totalGas = ethers.toBigInt(0);
  
  console.log(chalk.gray('='.repeat(80)));
  
  for (const tx of transactions) {
    console.log(chalk.white(`DARI     : ${tx.from}`));
    console.log(chalk.white(`KE       : ${tx.to}`));
    const decimals = tx.decimals || 18;
    console.log(chalk.white(`JUMLAH   : ${ethers.formatUnits(tx.amount, decimals)} ${tx.symbol}`));
    console.log(chalk.white(`GAS      : ${tx.gasLimit} units`));
    console.log(chalk.white(`GAS PRICE: ${ethers.formatUnits(tx.gasPrice, 'gwei')} Gwei`));
    console.log(chalk.gray('-'.repeat(80)));
    totalGas += ethers.toBigInt(tx.gasLimit) * ethers.toBigInt(tx.gasPrice);
  }
  
  console.log(chalk.yellow(`TOTAL ESTIMASI GAS FEE: ${ethers.formatEther(totalGas)} ${nativeSymbol}`));
  console.log(chalk.gray('='.repeat(80)));
}

// Fungsi utama
async function main() {
  try {
    log.big('🚀 MULTI-CHAIN TOKEN SENDER 🚀');
    console.log(chalk.bold.blue(`DITEMUKAN ${privateKeyList.length} PRIVATE KEY DI pk.txt`));
    
    // Pilih jaringan dengan nomor
    console.log(chalk.bold.white('\nPILIH JARINGAN:'));
    rpcConfig.forEach((net, index) => {
      let symbol = '';
      switch(net.chainId) {
        case 1: symbol = '💎'; break;
        case 56: symbol = '🟡'; break;
        case 137: symbol = '🟣'; break;
        case 43114: symbol = '❄️'; break;
        case 250: symbol = '👻'; break;
        case 42161: symbol = '🔷'; break;
        case 10: symbol = '🔴'; break;
        case 100: symbol = '🟢'; break;
        default: symbol = '⚪';
      }
      console.log(chalk.white(`   ${index + 1}. ${symbol} ${net.name} (Chain ID: ${net.chainId})`));
    });
    
    const { networkIndex } = await inquirer.prompt([
      {
        type: 'number',
        name: 'networkIndex',
        message: chalk.bold.white('MASUKKAN NOMOR JARINGAN:'),
        validate: input => {
          const num = parseInt(input);
          return num >= 1 && num <= rpcConfig.length || 'Nomor tidak valid!';
        }
      }
    ]);
    
    const network = rpcConfig[networkIndex - 1];
    const provider = getProvider(network.rpcUrl || network.endpoint);
    const { name, chainId, explorer } = network;
    
    // Dapatkan simbol native token dari konfigurasi atau default
    const symbol = network.symbol || 'BNB';
    
    log.header(`🌐 JARINGAN: ${name} (${symbol})`);

    // Pilih opsi utama dengan nomor
    console.log(chalk.bold.white('\nPILIH MODE:'));
    console.log(chalk.white('   1. 🪙 KIRIM TOKEN (BEP20/ERC20)'));
    console.log(chalk.white('   2. 💰 KIRIM NATIVE TOKEN'));
    
    const { mainOptionIndex } = await inquirer.prompt([
      {
        type: 'number',
        name: 'mainOptionIndex',
        message: chalk.bold.white('MASUKKAN NOMOR MODE:'),
        validate: input => {
          const num = parseInt(input);
          return num >= 1 && num <= 2 || 'Nomor tidak valid!';
        }
      }
    ]);
    
    const mainOption = mainOptionIndex === 1 ? 'token' : 'native';

    if (mainOption === 'token') {
      // Pilih sub opsi token dengan nomor
      console.log(chalk.bold.white('\nPILIH MODE PENGIRIMAN TOKEN:'));
      console.log(chalk.white('   1. 📤 SATU ADDRESS -> BANYAK ADDRESS'));
      console.log(chalk.white('   2. 📥 BANYAK ADDRESS -> SATU ADDRESS'));
      
      const { tokenOptionIndex } = await inquirer.prompt([
        {
          type: 'number',
          name: 'tokenOptionIndex',
          message: chalk.bold.white('MASUKKAN NOMOR MODE:'),
          validate: input => {
            const num = parseInt(input);
            return num >= 1 && num <= 2 || 'Nomor tidak valid!';
          }
        }
      ]);
      
      const tokenOption = tokenOptionIndex === 1 ? 'multi' : 'single';

      // Input token contract
      const { tokenAddress } = await inquirer.prompt([
        {
          type: 'input',
          name: 'tokenAddress',
          message: chalk.bold.white('MASUKKAN ALAMAT KONTRAK TOKEN:'),
          validate: input => ethers.isAddress(input) || 'Alamat tidak valid!'
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
        console.log(chalk.cyan('\n📤 Mode: Satu Address -> Banyak Address'));
        
        const { senderPk } = await inquirer.prompt([
          {
            type: 'input',
            name: 'senderPk',
            message: chalk.bold.white('MASUKKAN PRIVATE KEY PENGIRIM:'),
            default: process.env.PRIVATE_KEY || ''
          }
        ]);

        const wallet = getWallet(senderPk, provider);
        const senderAddress = await wallet.getAddress();
        
        console.log(chalk.white(`Pengirim: ${senderAddress}`));

        // Input recipients
        const { recipientsInput } = await inquirer.prompt([
          {
            type: 'input',
            name: 'recipientsInput',
            message: chalk.bold.white('MASUKKAN ALAMAT PENERIMA (pisahkan dengan koma):'),
            validate: input => {
              const addresses = input.split(',').map(addr => addr.trim());
              return addresses.every(addr => ethers.isAddress(addr)) || 'Ada alamat tidak valid!';
            }
          }
        ]);

        const recipients = recipientsInput.split(',').map(addr => addr.trim());
        console.log(chalk.white(`Jumlah Penerima: ${recipients.length}`));
        
        // Input amount
        const { amountPerRecipient } = await inquirer.prompt([
          {
            type: 'input',
            name: 'amountPerRecipient',
            message: chalk.bold.white(`MASUKKAN JUMLAH ${tokenSymbol} PER PENERIMA:`),
            validate: input => !isNaN(input) && parseFloat(input) > 0 || 'Jumlah tidak valid!'
          }
        ]);

        const amountPerRecipientWei = ethers.parseUnits(amountPerRecipient, tokenDecimals);
        const totalAmount = amountPerRecipientWei * ethers.toBigInt(recipients.length);

        // Cek saldo
        const balance = await tokenContract.balanceOf(senderAddress);
        if (balance < totalAmount) {
          throw new Error(`Saldo tidak cukup! Dibutuhkan: ${ethers.formatUnits(totalAmount, tokenDecimals)} ${tokenSymbol}, Tersedia: ${ethers.formatUnits(balance, tokenDecimals)} ${tokenSymbol}`);
        }

        // Prepare transactions
        const transactions = [];
        for (const recipient of recipients) {
          transactions.push({
            from: senderAddress,
            to: recipient,
            amount: amountPerRecipientWei,
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
            message: chalk.bold.white('LANJUTKAN TRANSAKSI?'),
            default: false
          }
        ]);

        if (confirm) {
          log.header('🚀 MEMULAI PENGIRIMAN TOKEN');
          for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            console.log(chalk.cyan(`🔄 Eksekusi ${i+1}/${transactions.length}: Wallet ${tx.from.substring(0, 8)}...${tx.from.substring(tx.from.length - 6)}`));
            
            try {
              const spinner = ora('Mengirim transaksi...').start();
              const txResponse = await sendTokenWithRetry(wallet, tokenContract, tx.to, tx.amount, explorer);
              spinner.succeed(`✅ Wallet ${i+1} Berhasil`);
              
              console.log(chalk.green(`✅ BERHASIL: ${ethers.formatUnits(tx.amount, tokenDecimals)} ${tokenSymbol} -> ${tx.to.substring(0, 8)}...${tx.to.substring(tx.to.length - 6)}`));
              console.log(chalk.blue(`🌐 Explorer: ${explorer}/tx/${txResponse.hash}`));
              console.log(chalk.gray('-'.repeat(60)));
            } catch (error) {
              console.log(chalk.red(`❌ GAGAL: ${error.message}`));
              console.log(chalk.gray('-'.repeat(60)));
            }
          }
          log.big('✅ SEMUA TRANSAKSI SELESAI');
        } else {
          log.warning('Transaksi dibatalkan');
        }
      } else {
        // Kirim token ke satu address dari banyak wallet
        console.log(chalk.cyan('\n📥 Mode: Banyak Address -> Satu Address'));
        
        const { recipientAddress } = await inquirer.prompt([
          {
            type: 'input',
            name: 'recipientAddress',
            message: chalk.bold.white('MASUKKAN ALAMAT PENERIMA:'),
            validate: input => ethers.isAddress(input) || 'Alamat tidak valid!'
          }
        ]);
        
        console.log(chalk.white(`Penerima: ${recipientAddress}`));

        // Pilih jumlah dengan nomor
        console.log(chalk.bold.white('\nPILIH JUMLAH:'));
        console.log(chalk.white('   1. 💰 Kirim Jumlah Tetap per Wallet'));
        console.log(chalk.white('   2. 🔄 Kirim Semua Saldo Token'));
        
        const { amountOptionIndex } = await inquirer.prompt([
          {
            type: 'number',
            name: 'amountOptionIndex',
            message: chalk.bold.white('MASUKKAN NOMOR OPSI:'),
            validate: input => {
              const num = parseInt(input);
              return num >= 1 && num <= 2 || 'Nomor tidak valid!';
            }
          }
        ]);
        
        const amountOption = amountOptionIndex === 1 ? 'fixed' : 'all';

        let amountPerWallet;
        if (amountOption === 'fixed') {
          const { amountInput } = await inquirer.prompt([
            {
              type: 'input',
              name: 'amountInput',
              message: chalk.bold.white(`MASUKKAN JUMLAH ${tokenSymbol} PER WALLET:`),
              validate: input => !isNaN(input) && parseFloat(input) > 0 || 'Jumlah tidak valid!'
            }
          ]);
          amountPerWallet = ethers.parseUnits(amountInput, tokenDecimals);
        }

        // Prepare transactions
        const transactions = [];
        console.log(chalk.white(`Memproses ${privateKeyList.length} wallet...`));
        console.log(chalk.gray('-'.repeat(50)));
        
        for (let i = 0; i < privateKeyList.length; i++) {
          const pk = privateKeyList[i];
          try {
            const wallet = getWallet(pk, provider);
            const senderAddress = await wallet.getAddress();
            console.log(chalk.white(`🔄 Memproses Wallet ${i+1}/${privateKeyList.length}: ${senderAddress}`));
            
            let amount;
            if (amountOption === 'all') {
              amount = await tokenContract.balanceOf(senderAddress);
              const formattedAmount = ethers.formatUnits(amount, tokenDecimals);
              console.log(chalk.white(`Saldo: ${formattedAmount} ${tokenSymbol}`));
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
              console.log(chalk.green(`✅ Transaksi ditambahkan dari ${senderAddress}`));
            } else {
              console.log(chalk.yellow(`⚠️ Melewati ${senderAddress} - saldo tidak cukup`));
            }
          } catch (error) {
            console.log(chalk.red(`❌ Error memproses wallet ${i+1}: ${error.message}`));
          }
        }

        console.log(chalk.gray('-'.repeat(50)));
        console.log(chalk.white(`Total transaksi: ${transactions.length}`));

        if (transactions.length === 0) {
          throw new Error('Tidak ada wallet dengan saldo token yang cukup');
        }

        // Preview
        await previewTransactions(transactions, symbol);

        // Konfirmasi
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: chalk.bold.white('LANJUTKAN TRANSAKSI?'),
            default: false
          }
        ]);

        if (confirm) {
          log.header('🚀 MEMULAI PENGIRIMAN TOKEN');
          for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            console.log(chalk.cyan(`🔄 Eksekusi ${i+1}/${transactions.length}: Wallet ${tx.from.substring(0, 8)}...${tx.from.substring(tx.from.length - 6)}`));
            
            try {
              const wallet = getWallet(privateKeyList.find(pk => {
                const w = getWallet(pk, provider);
                return w.address === tx.from;
              }), provider);
              
              const spinner = ora('Mengirim transaksi...').start();
              const txResponse = await sendTokenWithRetry(wallet, tokenContract, tx.to, tx.amount, explorer);
              spinner.succeed(`✅ Wallet ${i+1} Berhasil`);
              
              console.log(chalk.green(`✅ BERHASIL: ${ethers.formatUnits(tx.amount, tokenDecimals)} ${tokenSymbol} -> ${tx.to.substring(0, 8)}...${tx.to.substring(tx.to.length - 6)}`));
              console.log(chalk.blue(`🌐 Explorer: ${explorer}/tx/${txResponse.hash}`));
              console.log(chalk.gray('-'.repeat(60)));
            } catch (error) {
              console.log(chalk.red(`❌ GAGAL: ${error.message}`));
              console.log(chalk.gray('-'.repeat(60)));
            }
          }
          log.big('✅ SEMUA TRANSAKSI SELESAI');
        } else {
          log.warning('Transaksi dibatalkan');
        }
      }
    } else {
      // Opsi native token
      console.log(chalk.bold.white('\nPILIH MODE PENGIRIMAN NATIVE TOKEN:'));
      console.log(chalk.white('   1. 📤 SATU ADDRESS -> BANYAK ADDRESS'));
      console.log(chalk.white('   2. 📥 BANYAK ADDRESS -> SATU ADDRESS'));
      
      const { nativeOptionIndex } = await inquirer.prompt([
        {
          type: 'number',
          name: 'nativeOptionIndex',
          message: chalk.bold.white('MASUKKAN NOMOR MODE:'),
          validate: input => {
            const num = parseInt(input);
            return num >= 1 && num <= 2 || 'Nomor tidak valid!';
          }
        }
      ]);
      
      const nativeOption = nativeOptionIndex === 1 ? 'multi' : 'single';

      if (nativeOption === 'multi') {
        // Kirim native token ke banyak address
        console.log(chalk.cyan('\n📤 Mode: Satu Address -> Banyak Address'));
        
        const { senderPk } = await inquirer.prompt([
          {
            type: 'input',
            name: 'senderPk',
            message: chalk.bold.white('MASUKKAN PRIVATE KEY PENGIRIM:'),
            default: process.env.PRIVATE_KEY || ''
          }
        ]);

        const wallet = getWallet(senderPk, provider);
        const senderAddress = await wallet.getAddress();
        
        console.log(chalk.white(`Pengirim: ${senderAddress}`));

        // Input recipients
        const { recipientsInput } = await inquirer.prompt([
          {
            type: 'input',
            name: 'recipientsInput',
            message: chalk.bold.white('MASUKKAN ALAMAT PENERIMA (pisahkan dengan koma):'),
            validate: input => {
              const addresses = input.split(',').map(addr => addr.trim());
              return addresses.every(addr => ethers.isAddress(addr)) || 'Ada alamat tidak valid!';
            }
          }
        ]);

        const recipients = recipientsInput.split(',').map(addr => addr.trim());
        console.log(chalk.white(`Jumlah Penerima: ${recipients.length}`));
        
        // Input amount
        const { amountPerRecipient } = await inquirer.prompt([
          {
            type: 'input',
            name: 'amountPerRecipient',
            message: chalk.bold.white(`MASUKKAN JUMLAH ${symbol} PER PENERIMA:`),
            validate: input => !isNaN(input) && parseFloat(input) > 0 || 'Jumlah tidak valid!'
          }
        ]);

        const amountPerRecipientWei = ethers.parseEther(amountPerRecipient);
        const totalAmount = amountPerRecipientWei * ethers.toBigInt(recipients.length);

        // Cek saldo
        const balance = await provider.getBalance(senderAddress);
        if (balance < totalAmount) {
          throw new Error(`Saldo tidak cukup! Dibutuhkan: ${ethers.formatEther(totalAmount)} ${symbol}, Tersedia: ${ethers.formatEther(balance)} ${symbol}`);
        }

        // Prepare transactions
        const transactions = [];
        for (const recipient of recipients) {
          transactions.push({
            from: senderAddress,
            to: recipient,
            amount: amountPerRecipientWei,
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
            message: chalk.bold.white('LANJUTKAN TRANSAKSI?'),
            default: false
          }
        ]);

        if (confirm) {
          log.header('🚀 MEMULAI PENGIRIMAN NATIVE TOKEN');
          for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            console.log(chalk.cyan(`🔄 Eksekusi ${i+1}/${transactions.length}: Wallet ${tx.from.substring(0, 8)}...${tx.from.substring(tx.from.length - 6)}`));
            
            try {
              const spinner = ora('Mengirim transaksi...').start();
              const txResponse = await sendNativeWithRetry(wallet, tx.to, tx.amount, explorer);
              spinner.succeed(`✅ Wallet ${i+1} Berhasil`);
              
              console.log(chalk.green(`✅ BERHASIL: ${ethers.formatEther(tx.amount)} ${symbol} -> ${tx.to.substring(0, 8)}...${tx.to.substring(tx.to.length - 6)}`));
              console.log(chalk.blue(`🌐 Explorer: ${explorer}/tx/${txResponse.hash}`));
              console.log(chalk.gray('-'.repeat(60)));
            } catch (error) {
              console.log(chalk.red(`❌ GAGAL: ${error.message}`));
              console.log(chalk.gray('-'.repeat(60)));
            }
          }
          log.big('✅ SEMUA TRANSAKSI SELESAI');
        } else {
          log.warning('Transaksi dibatalkan');
        }
      } else {
        // Kirim native token ke satu address dari banyak wallet
        console.log(chalk.cyan('\n📥 Mode: Banyak Address -> Satu Address'));
        
        const { recipientAddress } = await inquirer.prompt([
          {
            type: 'input',
            name: 'recipientAddress',
            message: chalk.bold.white('MASUKKAN ALAMAT PENERIMA:'),
            validate: input => ethers.isAddress(input) || 'Alamat tidak valid!'
          }
        ]);
        
        console.log(chalk.white(`Penerima: ${recipientAddress}`));

        // Pilih jumlah dengan nomor
        console.log(chalk.bold.white('\nPILIH JUMLAH:'));
        console.log(chalk.white('   1. 💰 Kirim Jumlah Tetap per Wallet'));
        console.log(chalk.white('   2. 🔄 Kirim Semua Saldo'));
        
        const { amountOptionIndex } = await inquirer.prompt([
          {
            type: 'number',
            name: 'amountOptionIndex',
            message: chalk.bold.white('MASUKKAN NOMOR OPSI:'),
            validate: input => {
              const num = parseInt(input);
              return num >= 1 && num <= 2 || 'Nomor tidak valid!';
            }
          }
        ]);
        
        const amountOption = amountOptionIndex === 1 ? 'fixed' : 'all';

        let amountPerWallet;
        if (amountOption === 'fixed') {
          const { amountInput } = await inquirer.prompt([
            {
              type: 'input',
              name: 'amountInput',
              message: chalk.bold.white(`MASUKKAN JUMLAH ${symbol} PER WALLET:`),
              validate: input => !isNaN(input) && parseFloat(input) > 0 || 'Jumlah tidak valid!'
            }
          ]);
          amountPerWallet = ethers.parseEther(amountInput);
        }

        // Prepare transactions
        const transactions = [];
        console.log(chalk.white(`Memproses ${privateKeyList.length} wallet...`));
        console.log(chalk.gray('-'.repeat(50)));
        
        for (let i = 0; i < privateKeyList.length; i++) {
          const pk = privateKeyList[i];
          try {
            const wallet = getWallet(pk, provider);
            const senderAddress = await wallet.getAddress();
            console.log(chalk.white(`🔄 Memproses Wallet ${i+1}/${privateKeyList.length}: ${senderAddress}`));
            
            let amount;
            if (amountOption === 'all') {
              const balance = await provider.getBalance(senderAddress);
              // Kurangi biaya gas
              const gasPrice = await provider.getFeeData().then(fd => fd.gasPrice);
              const gasFee = gasPrice * ethers.toBigInt(21000);
              amount = balance - gasFee;
              const formattedAmount = ethers.formatEther(amount);
              console.log(chalk.white(`Saldo yang akan dikirim: ${formattedAmount} ${symbol}`));
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
              console.log(chalk.green(`✅ Transaksi ditambahkan dari ${senderAddress}`));
            } else {
              console.log(chalk.yellow(`⚠️ Melewati ${senderAddress} - saldo tidak cukup`));
            }
          } catch (error) {
            console.log(chalk.red(`❌ Error memproses wallet ${i+1}: ${error.message}`));
          }
        }

        console.log(chalk.gray('-'.repeat(50)));
        console.log(chalk.white(`Total transaksi: ${transactions.length}`));

        if (transactions.length === 0) {
          throw new Error('Tidak ada wallet dengan saldo yang cukup');
        }

        // Preview
        await previewTransactions(transactions, symbol);

        // Konfirmasi
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: chalk.bold.white('LANJUTKAN TRANSAKSI?'),
            default: false
          }
        ]);

        if (confirm) {
          log.header('🚀 MEMULAI PENGIRIMAN NATIVE TOKEN');
          for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            console.log(chalk.cyan(`🔄 Eksekusi ${i+1}/${transactions.length}: Wallet ${tx.from.substring(0, 8)}...${tx.from.substring(tx.from.length - 6)}`));
            
            try {
              const wallet = getWallet(privateKeyList.find(pk => {
                const w = getWallet(pk, provider);
                return w.address === tx.from;
              }), provider);
              
              const spinner = ora('Mengirim transaksi...').start();
              const txResponse = await sendNativeWithRetry(wallet, tx.to, tx.amount, explorer);
              spinner.succeed(`✅ Wallet ${i+1} Berhasil`);
              
              console.log(chalk.green(`✅ BERHASIL: ${ethers.formatEther(tx.amount)} ${symbol} -> ${tx.to.substring(0, 8)}...${tx.to.substring(tx.to.length - 6)}`));
              console.log(chalk.blue(`🌐 Explorer: ${explorer}/tx/${txResponse.hash}`));
              console.log(chalk.gray('-'.repeat(60)));
            } catch (error) {
              console.log(chalk.red(`❌ GAGAL: ${error.message}`));
              console.log(chalk.gray('-'.repeat(60)));
            }
          }
          log.big('✅ SEMUA TRANSAKSI SELESAI');
        } else {
          log.warning('Transaksi dibatalkan');
        }
      }
    }
  } catch (error) {
    log.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
