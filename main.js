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
  header: (msg) => console.log(chalk.bold.white.bgBlue(`\n${msg}\n`)),
  info: (msg) => console.log(chalk.blue(`ℹ️  ${msg}`)),
  success: (msg) => console.log(chalk.green(`✅ ${msg}`)),
  warning: (msg) => console.log(chalk.yellow(`⚠️  ${msg}`)),
  error: (msg) => console.log(chalk.red(`❌ ${msg}`)),
  big: (msg) => console.log(chalk.bold.white(`\n${msg}\n`)),
  step: (msg) => console.log(chalk.cyan(`🔄 ${msg}`)),
  tx: (msg) => console.log(chalk.magenta(`🔗 ${msg}`)),
  explorer: (hash, explorer) => console.log(chalk.blue(`🌐 Lihat di Explorer: ${explorer}/tx/${hash}`))
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
      const spinner = ora('Mengirim transaksi...').start();
      
      const tx = {
        to: to,
        value: amount,
        nonce: nonce,
        gasPrice: gasPrice,
        gasLimit: 21000
      };

      const txResponse = await wallet.sendTransaction(tx);
      spinner.succeed(`Transaksi terkirim: ${txResponse.hash}`);
      
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
      const spinner = ora('Mengirim transaksi...').start();
      
      const tx = await tokenContract.transfer.populateTransaction(to, amount);
      tx.nonce = nonce;
      tx.gasPrice = gasPrice;
      tx.gasLimit = 100000;

      const txResponse = await wallet.sendTransaction(tx);
      spinner.succeed(`Transaksi terkirim: ${txResponse.hash}`);
      
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
  
  for (const tx of transactions) {
    log.info(`DARI: ${tx.from}`);
    log.info(`KE: ${tx.to}`);
    const decimals = tx.decimals || 18;
    log.info(`JUMLAH: ${ethers.formatUnits(tx.amount, decimals)} ${tx.symbol}`);
    log.info(`ESTIMASI GAS: ${tx.gasLimit} units`);
    log.info(`GAS PRICE: ${ethers.formatUnits(tx.gasPrice, 'gwei')} Gwei`);
    log.info('----------------------------------');
    totalGas += ethers.toBigInt(tx.gasLimit) * ethers.toBigInt(tx.gasPrice);
  }
  
  log.warning(`TOTAL ESTIMASI GAS FEE: ${ethers.formatEther(totalGas)} ${nativeSymbol}`);
  log.header('=============================');
}

// Fungsi utama
async function main() {
  try {
    log.big('🚀 MULTI-CHAIN TOKEN SENDER 🚀');
    log.info(`Ditemukan ${privateKeyList.length} private key di pk.txt`);
    
    // Pilih jaringan
    const { network } = await inquirer.prompt([
      {
        type: 'list',
        name: 'network',
        message: chalk.bold.white('Pilih Jaringan:'),
        choices: rpcConfig.map(net => ({
          name: `${net.name} (Chain ID: ${net.chainId})`,
          value: net
        }))
      }
    ]);

    const provider = getProvider(network.rpcUrl || network.endpoint);
    const { name, chainId, explorer } = network;
    
    // Dapatkan simbol native token dari konfigurasi atau default
    const symbol = network.symbol || 'BNB';
    
    log.header(`🌐 JARINGAN: ${name} (${symbol})`);

    // Pilih opsi utama
    const { mainOption } = await inquirer.prompt([
      {
        type: 'list',
        name: 'mainOption',
        message: chalk.bold.white('PILIH MODE:'),
        choices: [
          { name: chalk.green('🪙 KIRIM TOKEN (BEP20/ERC20)'), value: 'token' },
          { name: chalk.yellow('💰 KIRIM NATIVE TOKEN'), value: 'native' }
        ]
      }
    ]);

    if (mainOption === 'token') {
      // Pilih sub opsi token
      const { tokenOption } = await inquirer.prompt([
        {
          type: 'list',
          name: 'tokenOption',
          message: chalk.bold.white('PILIH MODE PENGIRIMAN TOKEN:'),
          choices: [
            { name: chalk.blue('📤 SATU ADDRESS → BANYAK ADDRESS'), value: 'multi' },
            { name: chalk.magenta('📥 BANYAK ADDRESS → SATU ADDRESS'), value: 'single' }
          ]
        }
      ]);

      // Input token contract
      const { tokenAddress } = await inquirer.prompt([
        {
          type: 'input',
          name: 'tokenAddress',
          message: chalk.bold.white('Masukkan Alamat Kontrak Token:'),
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
        log.info('Mode: Satu Address → Banyak Address');
        
        const { senderPk } = await inquirer.prompt([
          {
            type: 'input',
            name: 'senderPk',
            message: chalk.bold.white('Masukkan Private Key Pengirim (atau tekan enter untuk .env):'),
            default: process.env.PRIVATE_KEY || ''
          }
        ]);

        const wallet = getWallet(senderPk, provider);
        const senderAddress = await wallet.getAddress();
        
        log.info(`Pengirim: ${senderAddress}`);

        // Input recipients
        const { recipientsInput } = await inquirer.prompt([
          {
            type: 'input',
            name: 'recipientsInput',
            message: chalk.bold.white('Masukkan Alamat Penerima (pisahkan dengan koma):'),
            validate: input => {
              const addresses = input.split(',').map(addr => addr.trim());
              return addresses.every(addr => ethers.isAddress(addr)) || 'Ada alamat tidak valid!';
            }
          }
        ]);

        const recipients = recipientsInput.split(',').map(addr => addr.trim());
        log.info(`Jumlah Penerima: ${recipients.length}`);
        
        // Input amount
        const { amountPerRecipient } = await inquirer.prompt([
          {
            type: 'input',
            name: 'amountPerRecipient',
            message: chalk.bold.white(`Masukkan Jumlah ${tokenSymbol} per Penerima:`),
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
          for (const tx of transactions) {
            await sendTokenWithRetry(wallet, tokenContract, tx.to, tx.amount, explorer);
            log.success(`BERHASIL MENGIRIM ${ethers.formatUnits(tx.amount, tokenDecimals)} ${tokenSymbol} KE ${tx.to}`);
          }
          log.big('✅ SEMUA TRANSAKSI SELESAI!');
        } else {
          log.warning('Transaksi dibatalkan');
        }
      } else {
        // Kirim token ke satu address dari banyak wallet
        log.info('Mode: Banyak Address → Satu Address');
        
        const { recipientAddress } = await inquirer.prompt([
          {
            type: 'input',
            name: 'recipientAddress',
            message: chalk.bold.white('Masukkan Alamat Penerima:'),
            validate: input => ethers.isAddress(input) || 'Alamat tidak valid!'
          }
        ]);
        
        log.info(`Penerima: ${recipientAddress}`);

        const { amountOption } = await inquirer.prompt([
          {
            type: 'list',
            name: 'amountOption',
            message: chalk.bold.white('PILIH JUMLAH:'),
            choices: [
              { name: chalk.cyan('💰 Kirim Jumlah Tetap per Wallet'), value: 'fixed' },
              { name: chalk.red('🔄 Kirim Semua Saldo Token'), value: 'all' }
            ]
          }
        ]);

        let amountPerWallet;
        if (amountOption === 'fixed') {
          const { amountInput } = await inquirer.prompt([
            {
              type: 'input',
              name: 'amountInput',
              message: chalk.bold.white(`Masukkan Jumlah ${tokenSymbol} per Wallet:`),
              validate: input => !isNaN(input) && parseFloat(input) > 0 || 'Jumlah tidak valid!'
            }
          ]);
          amountPerWallet = ethers.parseUnits(amountInput, tokenDecimals);
        }

        // Prepare transactions
        const transactions = [];
        log.info(`Memproses ${privateKeyList.length} wallet...`);
        
        for (let i = 0; i < privateKeyList.length; i++) {
          const pk = privateKeyList[i];
          try {
            const wallet = getWallet(pk, provider);
            const senderAddress = await wallet.getAddress();
            log.step(`Memproses Wallet ${i+1}/${privateKeyList.length}: ${senderAddress}`);
            
            let amount;
            if (amountOption === 'all') {
              amount = await tokenContract.balanceOf(senderAddress);
              const formattedAmount = ethers.formatUnits(amount, tokenDecimals);
              log.info(`Saldo: ${formattedAmount} ${tokenSymbol}`);
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
              log.success(`✓ Transaksi ditambahkan dari ${senderAddress}`);
            } else {
              log.warning(`✗ Melewati ${senderAddress} - saldo tidak cukup`);
            }
          } catch (error) {
            log.error(`✗ Error memproses wallet ${i+1}: ${error.message}`);
          }
        }

        log.info(`Total transaksi: ${transactions.length}`);

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
            log.step(`Eksekusi ${i+1}/${transactions.length} dari ${tx.from}`);
            
            try {
              const wallet = getWallet(privateKeyList.find(pk => {
                const w = getWallet(pk, provider);
                return w.address === tx.from;
              }), provider);
              
              await sendTokenWithRetry(wallet, tokenContract, tx.to, tx.amount, explorer);
              log.success(`✅ BERHASIL MENGIRIM ${ethers.formatUnits(tx.amount, tokenDecimals)} ${tokenSymbol} DARI ${tx.from} KE ${tx.to}`);
            } catch (error) {
              log.error(`❌ GAGAL MENGIRIM DARI ${tx.from}: ${error.message}`);
            }
          }
          log.big('✅ SEMUA TRANSAKSI SELESAI!');
        } else {
          log.warning('Transaksi dibatalkan');
        }
      }
    } else {
      // Opsi native token
      const { nativeOption } = await inquirer.prompt([
        {
          type: 'list',
          name: 'nativeOption',
          message: chalk.bold.white('PILIH MODE PENGIRIMAN NATIVE TOKEN:'),
          choices: [
            { name: chalk.blue('📤 SATU ADDRESS → BANYAK ADDRESS'), value: 'multi' },
            { name: chalk.magenta('📥 BANYAK ADDRESS → SATU ADDRESS'), value: 'single' }
          ]
        }
      ]);

      if (nativeOption === 'multi') {
        // Kirim native token ke banyak address
        log.info('Mode: Satu Address → Banyak Address');
        
        const { senderPk } = await inquirer.prompt([
          {
            type: 'input',
            name: 'senderPk',
            message: chalk.bold.white('Masukkan Private Key Pengirim (atau tekan enter untuk .env):'),
            default: process.env.PRIVATE_KEY || ''
          }
        ]);

        const wallet = getWallet(senderPk, provider);
        const senderAddress = await wallet.getAddress();
        
        log.info(`Pengirim: ${senderAddress}`);

        // Input recipients
        const { recipientsInput } = await inquirer.prompt([
          {
            type: 'input',
            name: 'recipientsInput',
            message: chalk.bold.white('Masukkan Alamat Penerima (pisahkan dengan koma):'),
            validate: input => {
              const addresses = input.split(',').map(addr => addr.trim());
              return addresses.every(addr => ethers.isAddress(addr)) || 'Ada alamat tidak valid!';
            }
          }
        ]);

        const recipients = recipientsInput.split(',').map(addr => addr.trim());
        log.info(`Jumlah Penerima: ${recipients.length}`);
        
        // Input amount
        const { amountPerRecipient } = await inquirer.prompt([
          {
            type: 'input',
            name: 'amountPerRecipient',
            message: chalk.bold.white(`Masukkan Jumlah ${symbol} per Penerima:`),
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
          for (const tx of transactions) {
            await sendNativeWithRetry(wallet, tx.to, tx.amount, explorer);
            log.success(`✅ BERHASIL MENGIRIM ${ethers.formatEther(tx.amount)} ${symbol} KE ${tx.to}`);
          }
          log.big('✅ SEMUA TRANSAKSI SELESAI!');
        } else {
          log.warning('Transaksi dibatalkan');
        }
      } else {
        // Kirim native token ke satu address dari banyak wallet
        log.info('Mode: Banyak Address → Satu Address');
        
        const { recipientAddress } = await inquirer.prompt([
          {
            type: 'input',
            name: 'recipientAddress',
            message: chalk.bold.white('Masukkan Alamat Penerima:'),
            validate: input => ethers.isAddress(input) || 'Alamat tidak valid!'
          }
        ]);
        
        log.info(`Penerima: ${recipientAddress}`);

        const { amountOption } = await inquirer.prompt([
          {
            type: 'list',
            name: 'amountOption',
            message: chalk.bold.white('PILIH JUMLAH:'),
            choices: [
              { name: chalk.cyan('💰 Kirim Jumlah Tetap per Wallet'), value: 'fixed' },
              { name: chalk.red('🔄 Kirim Semua Saldo'), value: 'all' }
            ]
          }
        ]);

        let amountPerWallet;
        if (amountOption === 'fixed') {
          const { amountInput } = await inquirer.prompt([
            {
              type: 'input',
              name: 'amountInput',
              message: chalk.bold.white(`Masukkan Jumlah ${symbol} per Wallet:`),
              validate: input => !isNaN(input) && parseFloat(input) > 0 || 'Jumlah tidak valid!'
            }
          ]);
          amountPerWallet = ethers.parseEther(amountInput);
        }

        // Prepare transactions
        const transactions = [];
        log.info(`Memproses ${privateKeyList.length} wallet...`);
        
        for (let i = 0; i < privateKeyList.length; i++) {
          const pk = privateKeyList[i];
          try {
            const wallet = getWallet(pk, provider);
            const senderAddress = await wallet.getAddress();
            log.step(`Memproses Wallet ${i+1}/${privateKeyList.length}: ${senderAddress}`);
            
            let amount;
            if (amountOption === 'all') {
              const balance = await provider.getBalance(senderAddress);
              // Kurangi biaya gas
              const gasPrice = await provider.getFeeData().then(fd => fd.gasPrice);
              const gasFee = gasPrice * ethers.toBigInt(21000);
              amount = balance - gasFee;
              const formattedAmount = ethers.formatEther(amount);
              log.info(`Saldo yang akan dikirim: ${formattedAmount} ${symbol}`);
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
              log.success(`✓ Transaksi ditambahkan dari ${senderAddress}`);
            } else {
              log.warning(`✗ Melewati ${senderAddress} - saldo tidak cukup`);
            }
          } catch (error) {
            log.error(`✗ Error memproses wallet ${i+1}: ${error.message}`);
          }
        }

        log.info(`Total transaksi: ${transactions.length}`);

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
            log.step(`Eksekusi ${i+1}/${transactions.length} dari ${tx.from}`);
            
            try {
              const wallet = getWallet(privateKeyList.find(pk => {
                const w = getWallet(pk, provider);
                return w.address === tx.from;
              }), provider);
              
              await sendNativeWithRetry(wallet, tx.to, tx.amount, explorer);
              log.success(`✅ BERHASIL MENGIRIM ${ethers.formatEther(tx.amount)} ${symbol} DARI ${tx.from} KE ${tx.to}`);
            } catch (error) {
              log.error(`❌ GAGAL MENGIRIM DARI ${tx.from}: ${error.message}`);
            }
          }
          log.big('✅ SEMUA TRANSAKSI SELESAI!');
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
