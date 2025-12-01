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
  // Hapus duplikat
  addressList = [...new Set(addressList)];
  console.log(chalk.green(`✅ DITEMUKAN ${addressList.length} ALAMAT PENERIMA UNIK DI ADDRESS.TXT`));
} catch (error) {
  console.log(chalk.yellow('⚠️ FILE ADDRESS.TXT TIDAK DITEMUKAN ATAU KOSONG'));
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
    case 8453: return '🔵'; // Base
    case 33139: return '🐒'; // ApeChain
    default: return '⚪';
  }
}

// Fungsi untuk menampilkan pesan dengan warna dan emoticon
const log = {
  header: (msg) => console.log(chalk.bold.black.bgYellow(`\n 🔖 ${msg.toUpperCase()} 🔖 \n`)),
  info: (msg) => console.log(chalk.blue(`📋 ${msg.toUpperCase()}`)),
  success: (msg) => console.log(chalk.green(`✅ ${msg.toUpperCase()}`)),
  warning: (msg) => console.log(chalk.yellow(`⚠️ ${msg.toUpperCase()}`)),
  error: (msg) => console.log(chalk.red(`❌ ${msg.toUpperCase()}`)),
  big: (msg) => console.log(chalk.bold.white(`\n🚀 ${msg.toUpperCase()} 🚀\n`)),
  step: (msg) => console.log(chalk.cyan(`🔄 ${msg.toUpperCase()}`)),
  tx: (msg) => console.log(chalk.magenta(`🔗 ${msg.toUpperCase()}`)),
  explorer: (hash, explorer) => console.log(chalk.blue(`🌐 EXPLORER: ${explorer}/tx/${hash}`))
};

// Fungsi untuk mendapatkan provider dengan fallback
function getProvider(network) {
  // Normalisasi konfigurasi RPC
  const rpcUrls = network.rpcUrls || [network.rpcUrl || network.endpoint];
  
  // Buat provider untuk setiap URL
  const providers = rpcUrls.map(url => {
    console.log(chalk.gray(`🔗 MENGHUBUNGKAN KE: ${url}`));
    return new ethers.JsonRpcProvider(url);
  });
  
  return {
    // Fungsi dengan fallback untuk getBalance
    getBalance: async (address) => {
      for (const provider of providers) {
        try {
          return await provider.getBalance(address);
        } catch (error) {
          console.log(chalk.yellow(`⚠️ RPC ${provider._connection.url} GAGAL, MENCOBA ENDPOINT LAIN...`));
          continue;
        }
      }
      throw new Error('SEMUA ENDPOINT RPC GAGAL');
    },
    
    // Fungsi dengan fallback untuk getFeeData
    getFeeData: async () => {
      for (const provider of providers) {
        try {
          return await provider.getFeeData();
        } catch (error) {
          continue;
        }
      }
      throw new Error('SEMUA ENDPOINT RPC GAGAL');
    },
    
    // Fungsi dengan fallback untuk getNetwork
    getNetwork: async () => {
      for (const provider of providers) {
        try {
          return await provider.getNetwork();
        } catch (error) {
          continue;
        }
      }
      throw new Error('SEMUA ENDPOINT RPC GAGAL');
    },
    
    // Fungsi dengan fallback untuk getBlockNumber
    getBlockNumber: async () => {
      for (const provider of providers) {
        try {
          return await provider.getBlockNumber();
        } catch (error) {
          continue;
        }
      }
      throw new Error('SEMUA ENDPOINT RPC GAGAL');
    },
    
    // Fungsi dengan fallback untuk getTransactionCount
    getTransactionCount: async (address, blockTag) => {
      for (const provider of providers) {
        try {
          return await provider.getTransactionCount(address, blockTag);
        } catch (error) {
          continue;
        }
      }
      throw new Error('SEMUA ENDPOINT RPC GAGAL');
    },
    
    // Fungsi dengan fallback untuk estimateGas
    estimateGas: async (transaction) => {
      for (const provider of providers) {
        try {
          return await provider.estimateGas(transaction);
        } catch (error) {
          continue;
        }
      }
      throw new Error('SEMUA ENDPOINT RPC GAGAL');
    },
    
    // Fungsi dengan fallback untuk call
    call: async (transaction, blockTag) => {
      for (const provider of providers) {
        try {
          return await provider.call(transaction, blockTag);
        } catch (error) {
          continue;
        }
      }
      throw new Error('SEMUA ENDPOINT RPC GAGAL');
    },
    
    // Kembalikan provider utama untuk digunakan oleh wallet
    getMainProvider: () => providers[0]
  };
}

// Fungsi untuk mendapatkan wallet
function getWallet(privateKey, provider) {
  return new ethers.Wallet(privateKey, provider.getMainProvider());
}

// Fungsi untuk menampilkan menu kecepatan transaksi
async function selectGasSpeed() {
  console.log(chalk.bold.white('\n⚡ PILIH KECEPATAN TRANSAKSI:'));
  console.log(chalk.white(`   1. 🐢 STANDARD (0.05 GWEI)`));
  console.log(chalk.white(`   2. 🚀 FAST (0.05 GWEI)`));
  console.log(chalk.white(`   3. 💨 RAPID (0.051 GWEI)`));
  
  const { speedIndex } = await inquirer.prompt([
    {
      type: 'number',
      name: 'speedIndex',
      message: chalk.bold.white('MASUKKAN NOMOR KECEPATAN:'),
      default: 1,
      validate: input => {
        const num = parseInt(input);
        return num >= 1 && num <= 3 || '❌ NOMOR TIDAK VALID!';
      }
    }
  ]);
  
  // Set gas price berdasarkan pilihan
  switch(speedIndex) {
    case 1: return ethers.parseUnits('0.05', 'gwei');
    case 2: return ethers.parseUnits('0.05', 'gwei');
    case 3: return ethers.parseUnits('0.051', 'gwei');
    default: return ethers.parseUnits('0.05', 'gwei');
  }
}

// Fungsi untuk mendapatkan gas price real-time dengan auto-adjust
async function getAdjustedGasPrice(provider, baseGasPrice) {
  try {
    const feeData = await provider.getFeeData();
    const currentGasPrice = feeData.gasPrice || baseGasPrice;
    
    // Jika gas price saat ini lebih tinggi dari base, gunakan yang lebih tinggi
    if (currentGasPrice > baseGasPrice) {
      console.log(chalk.yellow(`⚠️ GAS PRICE MENINGKAT DARI ${ethers.formatUnits(baseGasPrice, 'gwei')} KE ${ethers.formatUnits(currentGasPrice, 'gwei')} GWEI`));
      return currentGasPrice;
    }
    
    return baseGasPrice;
  } catch (error) {
    console.log(chalk.yellow(`⚠️ GAGAL MENDAPATKAN GAS PRICE REAL-TIME, MENGGUNAKAN BASE GAS PRICE`));
    return baseGasPrice;
  }
}

// Fungsi untuk mengirim native token dengan retry yang ditingkatkan
async function sendNativeWithRetry(wallet, to, amount, explorer, symbol, baseGasPrice, maxRetries = 5) {
  let nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
  
  // Dapatkan gas price yang disesuaikan dengan kondisi jaringan saat ini
  let gasPrice = await getAdjustedGasPrice(wallet.provider, baseGasPrice);
  
  // Pastikan gas price tidak terlalu rendah (minimal 0.05 Gwei untuk BSC)
  const minGasPrice = ethers.parseUnits('0.05', 'gwei');
  if (gasPrice < minGasPrice) {
    gasPrice = minGasPrice;
  }
  
  // Gunakan gas limit yang lebih konservatif untuk BSC
  const gasLimit = ethers.toBigInt(21000);
  const gasFee = gasPrice * gasLimit;
  
  // Dapatkan saldo aktual saat ini
  const balance = await wallet.provider.getBalance(wallet.address);
  
  // Cek saldo aktual dan sesuaikan amount jika perlu
  if (balance < amount + gasFee) {
    // Hitung ulang amount yang bisa dikirim
    const newAmount = balance - gasFee;
    
    if (newAmount <= 0) {
      throw new Error(`SALDO TIDAK CUKUP! DIBUTUHKAN: ${ethers.formatEther(amount + gasFee)} ${symbol} (TERMASUK GAS), TERSEDIA: ${ethers.formatEther(balance)} ${symbol}`);
    }
    
    // Ubah pesan penyesuaian menjadi lebih pendek dengan emoticon 🔁
    console.log(chalk.yellow(`🔁 MENYESUAIKAN ${ethers.formatEther(amount)} → ${ethers.formatEther(newAmount)} ${symbol.toUpperCase()}`));
    amount = newAmount;
  }
  
  for (let i = 0; i < maxRetries; i++) {
    // Buat spinner dengan animasi berputar dan tanpa emoticon default
    const spinner = ora({
      text: 'MENGIRIM TRANSAKSI...',
      spinner: 'dots',
      prefixText: ''
    }).start();
    
    try {
      // Update gas price sebelum setiap percobaan
      gasPrice = await getAdjustedGasPrice(wallet.provider, baseGasPrice);
      
      const tx = {
        to: to,
        value: amount,
        nonce: nonce,
        gasPrice: gasPrice,
        gasLimit: gasLimit
      };

      // Tampilkan informasi transaksi dengan format rapi dan warna putih
      console.log(chalk.white(`💰 AMOUNT : ${ethers.formatEther(amount)} ${symbol.toUpperCase()}`));
      console.log(chalk.white(`⛽ GAS FEE : ${ethers.formatEther(gasFee)} ${symbol.toUpperCase()}`));

      // Tambahkan timeout untuk transaksi
      const txResponse = await Promise.race([
        wallet.sendTransaction(tx),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('TRANSACTION TIMEOUT')), 30000)
        )
      ]);
      
      // Hentikan spinner dan tampilkan pesan sukses dengan emoticon ✅
      spinner.stop();
      console.log(chalk.green('✅ TRANSAKSI TERKIRIM'));
      
      // Tampilkan explorer link dengan format rapi
      console.log(chalk.blue(`🌐 EXPLORER : ${explorer}/tx/${txResponse.hash}`));
      
      return txResponse;
    } catch (error) {
      spinner.fail(`GAGAL: ${error.message.toUpperCase()}`);
      
      if (error.message.includes('NONCE TOO LOW')) {
        log.warning(`NONCE TERLALU RENDAH, MENCOBA LAGI... (${i + 1}/${maxRetries})`);
        nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
      } else if (error.message.includes('REPLACEMENT FEE TOO LOW') || error.message.includes('GAS PRICE TOO LOW')) {
        log.warning(`FEE TERLALU RENDAH, MENAIKKAN GAS PRICE... (${i + 1}/${maxRetries})`);
        // Tambahkan 10% ke gas price setiap retry
        gasPrice = (gasPrice * ethers.toBigInt(110)) / ethers.toBigInt(100);
      } else if (error.message.includes('INSUFFICIENT FUNDS')) {
        // Coba kurangi amount
        const currentBalance = await wallet.provider.getBalance(wallet.address);
        const currentGasFee = gasPrice * gasLimit;
        
        if (currentBalance > currentGasFee) {
          const newAmount = currentBalance - currentGasFee;
          // Ubah pesan penyesuaian menjadi lebih pendek dengan emoticon 🔁
          console.log(chalk.yellow(`🔁 MENYESUAIKAN ${ethers.formatEther(amount)} → ${ethers.formatEther(newAmount)} ${symbol.toUpperCase()}`));
          amount = newAmount;
        } else {
          log.error(`SALDO TIDAK CUKUP UNTUK TRANSAKSI`);
          throw error;
        }
      } else if (error.message.includes('INTRINSIC GAS')) {
        log.warning(`MASALAH GAS LIMIT, MENAIKKAN GAS LIMIT... (${i + 1}/${maxRetries})`);
        // Tambahkan 30% ke gas limit
        gasLimit = (gasLimit * ethers.toBigInt(130)) / ethers.toBigInt(100);
        // Tunggu sebelum mencoba lagi
        await new Promise(resolve => setTimeout(resolve, 3000));
        // Dapatkan nonce dan gas price terbaru
        nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
        gasPrice = await getAdjustedGasPrice(wallet.provider, baseGasPrice);
      } else if (error.code === -32000 || error.message.includes('COULD NOT COALESCE')) {
        log.warning(`MASALAH KONEKSI RPC, MENCOBA LAGI... (${i + 1}/${maxRetries})`);
        // Tunggu lebih lama untuk masalah koneksi
        await new Promise(resolve => setTimeout(resolve, 5000));
        // Dapatkan nonce dan gas price terbaru
        nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
        gasPrice = await getAdjustedGasPrice(wallet.provider, baseGasPrice);
      } else {
        log.error(`ERROR TIDAK TERDUGA: ${error.message.toUpperCase()}`);
        if (i === maxRetries - 1) throw error;
      }
      
      // Tunggu sebelum mencoba lagi
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  throw new Error('MAX RETRIES REACHED');
}

// Fungsi untuk mengirim token dengan retry yang ditingkatkan (diperbaiki untuk BEP20)
async function sendTokenWithRetry(wallet, tokenContract, to, amount, explorer, symbol, baseGasPrice, maxRetries = 5) {
  let nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
  
  // Dapatkan gas price yang disesuaikan dengan kondisi jaringan saat ini
  let gasPrice = await getAdjustedGasPrice(wallet.provider, baseGasPrice);
  
  // Pastikan gas price tidak terlalu rendah (minimal 0.05 Gwei untuk BSC)
  const minGasPrice = ethers.parseUnits('0.05', 'gwei');
  if (gasPrice < minGasPrice) {
    gasPrice = minGasPrice;
  }
  
  for (let i = 0; i < maxRetries; i++) {
    // Buat spinner dengan animasi berputar dan tanpa emoticon default
    const spinner = ora({
      text: 'MENGIRIM TRANSAKSI...',
      spinner: 'dots',
      prefixText: ''
    }).start();
    
    try {
      // Update gas price sebelum setiap percobaan
      gasPrice = await getAdjustedGasPrice(wallet.provider, baseGasPrice);
      
      // Langsung gunakan metode alternatif yang lebih andal
      const gasLimit = await tokenContract.transfer.estimateGas(to, amount, { from: wallet.address });
      const tx = await tokenContract.transfer.populateTransaction(to, amount);
      tx.nonce = nonce;
      tx.gasPrice = gasPrice;
      tx.gasLimit = gasLimit * ethers.toBigInt(120) / ethers.toBigInt(100); // Buffer 20%

      // Tampilkan informasi transaksi dengan format rapi dan warna putih
      console.log(chalk.white(`💰 AMOUNT : ${ethers.formatUnits(amount, 18)} ${symbol.toUpperCase()}`));
      console.log(chalk.white(`⛽ GAS FEE : ${ethers.formatEther(gasPrice * tx.gasLimit)} BNB`));

      // Tambahkan timeout untuk transaksi
      const txResponse = await Promise.race([
        wallet.sendTransaction(tx),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('TRANSACTION TIMEOUT')), 30000)
        )
      ]);
      
      // Hentikan spinner dan tampilkan pesan sukses dengan emoticon ✅
      spinner.stop();
      console.log(chalk.green('✅ TRANSAKSI TERKIRIM'));
      
      // Tampilkan explorer link dengan format rapi
      console.log(chalk.blue(`🌐 EXPLORER : ${explorer}/tx/${txResponse.hash}`));
      
      return txResponse;
    } catch (error) {
      spinner.fail(`GAGAL: ${error.message.toUpperCase()}`);
      
      if (error.message.includes('NONCE TOO LOW')) {
        log.warning(`NONCE TERLALU RENDAH, MENCOBA LAGI... (${i + 1}/${maxRetries})`);
        nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
      } else if (error.message.includes('REPLACEMENT FEE TOO LOW') || error.message.includes('GAS PRICE TOO LOW')) {
        log.warning(`FEE TERLALU RENDAH, MENAIKKAN GAS PRICE... (${i + 1}/${maxRetries})`);
        // Tambahkan 10% ke gas price setiap retry
        gasPrice = (gasPrice * ethers.toBigInt(110)) / ethers.toBigInt(100);
      } else if (error.message.includes('INSUFFICIENT FUNDS')) {
        log.error(`SALDO TIDAK CUKUP UNTUK TRANSAKSI`);
        throw error;
      } else if (error.message.includes('INTRINSIC GAS')) {
        log.warning(`MASALAH GAS LIMIT, MENAIKKAN GAS LIMIT... (${i + 1}/${maxRetries})`);
        // Tunggu sebelum mencoba lagi
        await new Promise(resolve => setTimeout(resolve, 3000));
        // Dapatkan nonce dan gas price terbaru
        nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
        gasPrice = await getAdjustedGasPrice(wallet.provider, baseGasPrice);
      } else if (error.code === -32000 || error.message.includes('COULD NOT COALESCE')) {
        log.warning(`MASALAH KONEKSI RPC, MENCOBA LAGI... (${i + 1}/${maxRetries})`);
        // Tunggu lebih lama untuk masalah koneksi
        await new Promise(resolve => setTimeout(resolve, 5000));
        // Dapatkan nonce dan gas price terbaru
        nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
        gasPrice = await getAdjustedGasPrice(wallet.provider, baseGasPrice);
      } else {
        log.error(`ERROR TIDAK TERDUGA: ${error.message.toUpperCase()}`);
        if (i === maxRetries - 1) throw error;
      }
      
      // Tunggu sebelum mencoba lagi
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  throw new Error('MAX RETRIES REACHED');
}

// Fungsi untuk preview transaksi (diperbaiki - dengan emoticon dan sejajar)
async function previewTransactions(transactions, tokenSymbol = null) {
  log.header('📋 PREVIEW TRANSAKSI');
  
  let totalGas = ethers.toBigInt(0);
  let totalAmount = ethers.toBigInt(0);
  
  // Hitung total
  for (const tx of transactions) {
    totalGas += ethers.toBigInt(tx.gasLimit) * ethers.toBigInt(tx.gasPrice);
    totalAmount += tx.amount;
  }
  
  // Gunakan tokenSymbol jika disediakan, jika tidak gunakan simbol dari transaksi pertama
  const displaySymbol = tokenSymbol || (transactions.length > 0 ? transactions[0].symbol : 'TOKEN');
  const displayDecimals = transactions.length > 0 ? (transactions[0].decimals || 18) : 18;
  const recipientAddress = transactions.length > 0 ? transactions[0].to : 'N/A';
  
  // Format setiap baris dengan padding yang konsisten
  const padding = 20; // Jarak spasi setelah label
  
  console.log(chalk.white(`👛 TOTAL WALLET${' '.repeat(padding - 14)}: ${transactions.length}`));
  console.log(chalk.white(`👤 PENERIMA${' '.repeat(padding - 10)}: ${shortenAddress(recipientAddress)}`));
  console.log(chalk.white(`💰 TOTAL KIRIM${' '.repeat(padding - 13)}: ${ethers.formatUnits(totalAmount, displayDecimals)} ${displaySymbol.toUpperCase()}`));
  console.log(chalk.white(`⛽ ESTIMASI GAS FEE${' '.repeat(padding - 18)}: ${ethers.formatEther(totalGas)} BNB`));
  console.log(chalk.gray('='.repeat(50)));
}

// Fungsi untuk memproses wallet secara paralel (diperbaiki - tanpa minimal saldo)
async function processWalletsInParallel(provider, privateKeyList, amountOption, amountPerWallet, recipientAddress, symbol, gasPrice) {
  const batchSize = 15; // Tingkatkan batch size untuk proses lebih cepat
  const results = [];
  
  console.log(chalk.white(`🔄 MEMPROSES ${privateKeyList.length} WALLET SECARA PARALEL...`));
  
  // Create progress bar for wallet processing
  const progressBar = new cliProgress.SingleBar({
    format: '🔄 PROCESSING WALLETS |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} WALLETS',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });
  
  progressBar.start(privateKeyList.length, 0);
  
  // Counter untuk estimasi gas gagal
  let failedEstimationCount = 0;
  
  for (let i = 0; i < privateKeyList.length; i += batchSize) {
    const batch = privateKeyList.slice(i, i + batchSize);
    const batchPromises = batch.map(async (pk, index) => {
      try {
        const wallet = getWallet(pk, provider);
        const senderAddress = await wallet.getAddress();
        
        // Skip jika mengirim ke diri sendiri
        if (senderAddress.toLowerCase() === recipientAddress.toLowerCase()) {
          return {
            success: false,
            address: senderAddress,
            reason: 'MENGIRIM KE DIRI SENDIRI'
          };
        }
        
        const balance = await provider.getBalance(senderAddress);
        
        // Gunakan gas limit yang lebih konservatif untuk BSC
        const gasLimit = ethers.toBigInt(21000); // Default untuk BSC
        const gasFee = gasPrice * gasLimit;
        
        let amount;
        if (amountOption === 'all') {
          // Untuk opsi "all", kirim semua saldo kecuali biaya gas
          if (balance <= gasFee) {
            return {
              success: false,
              address: senderAddress,
              reason: 'SALDO TIDAK CUKUP UNTUK BIAYA GAS'
            };
          }
          amount = balance - gasFee;
        } else {
          // Untuk opsi "fixed", gunakan jumlah yang ditentukan
          amount = amountPerWallet;
          
          // Pastikan saldo cukup untuk amount + gasFee
          const totalNeeded = amount + gasFee;
          if (balance < totalNeeded) {
            return {
              success: false,
              address: senderAddress,
              reason: 'SALDO TIDAK CUKUP'
            };
          }
        }

        if (amount > 0) {
          return {
            success: true,
            from: senderAddress,
            to: recipientAddress,
            amount: amount,
            symbol: symbol,
            decimals: 18,
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            privateKey: pk // Simpan private key untuk eksekusi
          };
        } else {
          return {
            success: false,
            address: senderAddress,
            reason: 'SALDO TIDAK CUKUP'
          };
        }
      } catch (error) {
        return {
          success: false,
          address: 'unknown',
          reason: `ERROR: ${error.message.toUpperCase()}`
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    progressBar.update(i + batch.length);
  }
  
  progressBar.stop();
  
  // Tampilkan pesan ringkasan jika ada estimasi gas yang gagal
  if (failedEstimationCount > 0) {
    console.log(chalk.yellow(`⚠️ ESTIMASI GAS GAGAL UNTUK ${failedEstimationCount} WALLET, MENGGUNAKAN DEFAULT`));
  }
  
  // Tampilkan ringkasan
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(chalk.green(`✅ ${successful.length} WALLET SIAP UNTUK TRANSAKSI`));
  console.log(chalk.yellow(`⚠️ ${failed.length} WALLET DILEWATI`));
  
  // Tampilkan detail wallet yang gagal (hanya 5 pertama untuk menghindari spam)
  if (failed.length > 0) {
    console.log(chalk.gray('\nDETAIL WALLET YANG DILEWATI (HANYA 5 PERTAMA):'));
    failed.slice(0, 5).forEach((result, index) => {
      console.log(chalk.yellow(`   ${index + 1}. ${shortenAddress(result.address)} - ${result.reason.toUpperCase()}`));
    });
    if (failed.length > 5) {
      console.log(chalk.gray(`   ... DAN ${failed.length - 5} LAINNYA`));
    }
  }
  
  return successful;
}

// Fungsi untuk memproses wallet token secara paralel
async function processTokenWalletsInParallel(provider, privateKeyList, tokenContract, amountOption, amountPerWallet, recipientAddress, tokenSymbol, gasPrice) {
  const batchSize = 15; // Tingkatkan batch size untuk proses lebih cepat
  const results = [];
  
  console.log(chalk.white(`🔄 MEMPROSES ${privateKeyList.length} WALLET SECARA PARALEL...`));
  
  // Create progress bar for wallet processing
  const progressBar = new cliProgress.SingleBar({
    format: '🔄 PROCESSING WALLETS |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} WALLETS',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });
  
  progressBar.start(privateKeyList.length, 0);
  
  // Counter untuk estimasi gas gagal
  let failedEstimationCount = 0;
  
  for (let i = 0; i < privateKeyList.length; i += batchSize) {
    const batch = privateKeyList.slice(i, i + batchSize);
    const batchPromises = batch.map(async (pk, index) => {
      try {
        const wallet = getWallet(pk, provider);
        const senderAddress = await wallet.getAddress();
        
        // Skip jika mengirim ke diri sendiri
        if (senderAddress.toLowerCase() === recipientAddress.toLowerCase()) {
          return {
            success: false,
            address: senderAddress,
            reason: 'MENGIRIM KE DIRI SENDIRI'
          };
        }
        
        let amount;
        if (amountOption === 'all') {
          amount = await tokenContract.balanceOf(senderAddress);
        } else {
          amount = amountPerWallet;
        }

        if (amount > 0) {
          const nativeBalance = await provider.getBalance(senderAddress);
          
          // Gunakan gas limit yang lebih konservatif
          const gasLimit = ethers.toBigInt(100000); // Default untuk token
          const gasFee = gasPrice * gasLimit;
          
          if (nativeBalance < gasFee) {
            return {
              success: false,
              address: senderAddress,
              reason: 'SALDO NATIVE TOKEN TIDAK CUKUP UNTUK BIAYA GAS'
            };
          }
          
          return {
            success: true,
            from: senderAddress,
            to: recipientAddress,
            amount: amount,
            symbol: tokenSymbol,
            decimals: await tokenContract.decimals(),
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            privateKey: pk // Simpan private key untuk eksekusi
          };
        } else {
          return {
            success: false,
            address: senderAddress,
            reason: 'SALDO TOKEN TIDAK CUKUP'
          };
        }
      } catch (error) {
        return {
          success: false,
          address: 'unknown',
          reason: `ERROR: ${error.message.toUpperCase()}`
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    progressBar.update(i + batch.length);
  }
  
  progressBar.stop();
  
  // Tampilkan pesan ringkasan jika ada estimasi gas yang gagal
  if (failedEstimationCount > 0) {
    console.log(chalk.yellow(`⚠️ ESTIMASI GAS GAGAL UNTUK ${failedEstimationCount} WALLET, MENGGUNAKAN DEFAULT`));
  }
  
  // Tampilkan ringkasan
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(chalk.green(`✅ ${successful.length} WALLET SIAP UNTUK TRANSAKSI`));
  console.log(chalk.yellow(`⚠️ ${failed.length} WALLET DILEWATI`));
  
  // Tampilkan detail wallet yang gagal (hanya 5 pertama untuk menghindari spam)
  if (failed.length > 0) {
    console.log(chalk.gray('\nDETAIL WALLET YANG DILEWATI (HANYA 5 PERTAMA):'));
    failed.slice(0, 5).forEach((result, index) => {
      console.log(chalk.yellow(`   ${index + 1}. ${shortenAddress(result.address)} - ${result.reason.toUpperCase()}`));
    });
    if (failed.length > 5) {
      console.log(chalk.gray(`   ... DAN ${failed.length - 5} LAINNYA`));
    }
  }
  
  return successful;
}

// Fungsi untuk menampilkan menu jaringan
async function selectNetwork() {
  console.log(chalk.bold.white('\n🌐 PILIH JARINGAN:'));
  rpcConfig.forEach((net, index) => {
    const emoji = getNetworkEmoji(net.chainId);
    console.log(chalk.white(`   ${index + 1}. ${emoji} ${net.name.toUpperCase()} (CHAIN ID: ${net.chainId})`));
  });
  
  const { networkIndex } = await inquirer.prompt([
    {
      type: 'number',
      name: 'networkIndex',
      message: chalk.bold.white('MASUKKAN NOMOR JARINGAN:'),
      validate: input => {
        const num = parseInt(input);
        return num >= 1 && num <= rpcConfig.length || '❌ NOMOR TIDAK VALID!';
      }
    }
  ]);
  
  return rpcConfig[networkIndex - 1];
}

// Fungsi untuk menampilkan menu mode
async function selectMode(title, options) {
  console.log(chalk.bold.white(`\n${title.toUpperCase()}:`));
  options.forEach((option, index) => {
    console.log(chalk.white(`   ${index + 1}. ${option.toUpperCase()}`));
  });
  
  const { optionIndex } = await inquirer.prompt([
    {
      type: 'number',
      name: 'optionIndex',
      message: chalk.bold.white('MASUKKAN NOMOR PILIHAN:'),
      validate: input => {
        const num = parseInt(input);
        return num >= 1 && num <= options.length || '❌ NOMOR TIDAK VALID!';
      }
    }
  ]);
  
  return optionIndex - 1;
}

// Fungsi utama
async function main() {
  try {
    log.big('🚀 MULTI-CHAIN TOKEN SENDER 🚀');
    console.log(chalk.bold.blue(`🔑 DITEMUKAN ${privateKeyList.length} PRIVATE KEY DI PK.TXT`));
    
    // Pilih jaringan
    const network = await selectNetwork();
    const provider = getProvider(network);
    const { name, chainId, explorer } = network;
    const emoji = getNetworkEmoji(chainId);
    
    // Dapatkan simbol native token dari konfigurasi atau default
    const symbol = network.symbol || 'BNB';
    
    log.header(`${emoji} JARINGAN: ${name.toUpperCase()} (${symbol.toUpperCase()})`);

    // Pilih kecepatan transaksi
    const baseGasPrice = await selectGasSpeed();
    console.log(chalk.white(`⚡ BASE GAS PRICE: ${ethers.formatUnits(baseGasPrice, 'gwei')} GWEI`));

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
          validate: input => ethers.isAddress(input) || '❌ ALAMAT TIDAK VALID!'
        }
      ]);

      console.log(chalk.white(`🔗 MENGHUBUNGKAN KE KONTRAK TOKEN: ${tokenAddress}`));

      const tokenContract = new ethers.Contract(
        tokenAddress,
        [
          'function transfer(address to, uint amount) returns (bool)',
          'function balanceOf(address owner) view returns (uint)',
          'function decimals() view returns (uint8)',
          'function symbol() view returns (string)',
          'function name() view returns (string)'
        ],
        provider.getMainProvider()
      );

      // Deklarasikan variabel token di luar try-catch
      let tokenSymbol, tokenName, tokenDecimals;

      // Coba dapatkan info token untuk memastikan koneksi berhasil
      try {
        tokenSymbol = await tokenContract.symbol();
        tokenName = await tokenContract.name();
        tokenDecimals = await tokenContract.decimals();
        
        log.header(`🪙 TOKEN: ${tokenName.toUpperCase()} (${tokenSymbol.toUpperCase()})`);
        console.log(chalk.white(`📊 DECIMALS: ${tokenDecimals}`));
      } catch (error) {
        throw new Error(`GAGAL TERHUBUNG KE KONTRAK TOKEN: ${error.message.toUpperCase()}`);
      }

      if (tokenOption === 'multi') {
        // Kirim token ke banyak address
        console.log(chalk.cyan('\n📤 MODE: SATU ADDRESS → BANYAK ADDRESS'));
        
        const { senderPk } = await inquirer.prompt([
          {
            type: 'password',
            name: 'senderPk',
            message: chalk.bold.white('🔑 MASUKKAN PRIVATE KEY PENGIRIM (ATAU TEKAN ENTER UNTUK .ENV):'),
            default: process.env.PRIVATE_KEY || '',
            mask: '*'
          }
        ]);

        const wallet = getWallet(senderPk, provider);
        const senderAddress = await wallet.getAddress();
        
        console.log(chalk.white(`👤 PENGIRIM: ${shortenAddress(senderAddress)}`));

        // Gunakan alamat dari file address.txt
        if (addressList.length === 0) {
          throw new Error('❌ TIDAK ADA ALAMAT PENERIMA YANG VALID DI ADDRESS.TXT');
        }
        
        const recipients = addressList;
        console.log(chalk.white(`👥 JUMLAH PENERIMA: ${recipients.length}`));
        
        // Input amount
        const amountOptions = [
          '🔄 KIRIM SEMUA SALDO',
          '💰 TENTUKAN NOMINAL'
        ];
        const amountOptionIndex = await selectMode('💸 PILIH JUMLAH', amountOptions);
        const amountOption = amountOptionIndex === 0 ? 'all' : 'fixed';

        let amountPerRecipient;
        if (amountOption === 'fixed') {
          const { amountInput } = await inquirer.prompt([
            {
              type: 'input',
              name: 'amountInput',
              message: chalk.bold.white(`💰 MASUKKAN JUMLAH ${tokenSymbol.toUpperCase()} PER PENERIMA:`),
              validate: input => !isNaN(input) && parseFloat(input) > 0 || '❌ JUMLAH TIDAK VALID!'
            }
          ]);
          amountPerRecipient = ethers.parseUnits(amountInput, tokenDecimals);
        } else {
          // Hitung saldo per penerima
          const balance = await tokenContract.balanceOf(senderAddress);
          amountPerRecipient = balance / ethers.toBigInt(recipients.length);
          console.log(chalk.white(`💱 SALDO PER PENERIMA: ${ethers.formatUnits(amountPerRecipient, tokenDecimals)} ${tokenSymbol.toUpperCase()}`));
        }

        const totalAmount = amountPerRecipient * ethers.toBigInt(recipients.length);

        // Cek saldo token
        const balance = await tokenContract.balanceOf(senderAddress);
        if (balance < totalAmount) {
          throw new Error(`❌ SALDO TOKEN TIDAK CUKUP! DIBUTUHKAN: ${ethers.formatUnits(totalAmount, tokenDecimals)} ${tokenSymbol.toUpperCase()}, TERSEDIA: ${ethers.formatUnits(balance, tokenDecimals)} ${tokenSymbol.toUpperCase()}`);
        }

        // Cek saldo native token untuk biaya gas
        const nativeBalance = await provider.getBalance(senderAddress);
        const estimatedGasCost = baseGasPrice * ethers.toBigInt(100000) * ethers.toBigInt(recipients.length);
        
        if (nativeBalance < estimatedGasCost) {
          throw new Error(`❌ SALDO NATIVE TOKEN TIDAK CUKUP UNTUK BIAYA GAS! DIBUTUHKAN: ${ethers.formatEther(estimatedGasCost)} ${symbol.toUpperCase()}, TERSEDIA: ${ethers.formatEther(nativeBalance)} ${symbol.toUpperCase()}`);
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
            gasPrice: baseGasPrice
          });
        }

        // Preview
        await previewTransactions(transactions, tokenSymbol);

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
            format: '📤 PROGRESS |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} TRANSACTIONS',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
          });
          
          progressBar.start(transactions.length, 0);
          console.log(); // Tambahkan baris kosong setelah progress bar
          
          for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            console.log(chalk.cyan(`\n🔄 EKSEKUSI ${i+1}/${transactions.length}: ${shortenAddress(tx.from)} → ${shortenAddress(tx.to)}`));
            
            try {
              await sendTokenWithRetry(wallet, tokenContract, tx.to, tx.amount, explorer, tokenSymbol, baseGasPrice);
              progressBar.update(i + 1);
              console.log(); // Tambahkan baris kosong setelah update progress bar
              
              // Tambahkan delay antar transaksi (1-2 detik) - dipercepat
              const delay = Math.floor(Math.random() * 1000) + 1000;
              console.log(chalk.gray(`⏳ MENUNGGU ${delay/1000} DETIK SEBELUM TRANSAKSI BERIKUTNYA...`));
              await new Promise(resolve => setTimeout(resolve, delay));
              console.log(); // Tambahkan baris kosong setelah delay
            } catch (error) {
              log.error(`❌ GAGAL: ${error.message.toUpperCase()}`);
              progressBar.update(i + 1);
              console.log(); // Tambahkan baris kosong setelah error
            }
          }
          
          progressBar.stop();
          console.log(); // Tambahkan baris kosong setelah progress bar selesai
          log.big('✅ SEMUA TRANSAKSI SELESAI');
        } else {
          log.warning('⚠️ TRANSAKSI DIBATALKAN');
        }
      } else {
        // Kirim token ke satu address dari banyak wallet
        console.log(chalk.cyan('\n📥 MODE: BANYAK ADDRESS → SATU ADDRESS'));
        
        const { recipientAddress } = await inquirer.prompt([
          {
            type: 'input',
            name: 'recipientAddress',
            message: chalk.bold.white('📝 MASUKKAN ALAMAT PENERIMA:'),
            validate: input => ethers.isAddress(input) || '❌ ALAMAT TIDAK VALID!'
          }
        ]);
        
        console.log(chalk.white(`👤 PENERIMA: ${shortenAddress(recipientAddress)}`));

        const amountOptions = [
          '🔄 KIRIM SEMUA SALDO',
          '💰 TENTUKAN NOMINAL'
        ];
        const amountOptionIndex = await selectMode('💸 PILIH JUMLAH', amountOptions);
        const amountOption = amountOptionIndex === 0 ? 'all' : 'fixed';

        let amountPerWallet;
        if (amountOption === 'fixed') {
          const { amountInput } = await inquirer.prompt([
            {
              type: 'input',
              name: 'amountInput',
              message: chalk.bold.white(`💰 MASUKKAN JUMLAH ${tokenSymbol.toUpperCase()} PER WALLET:`),
              validate: input => !isNaN(input) && parseFloat(input) > 0 || '❌ JUMLAH TIDAK VALID!'
            }
          ]);
          amountPerWallet = ethers.parseUnits(amountInput, tokenDecimals);
        }

        // Prepare transactions dengan pemrosesan paralel
        console.log(chalk.gray('-'.repeat(50)));
        const transactions = await processTokenWalletsInParallel(
          provider, 
          privateKeyList, 
          tokenContract, 
          amountOption, 
          amountPerWallet, 
          recipientAddress, 
          tokenSymbol,
          baseGasPrice
        );
        console.log(chalk.gray('-'.repeat(50)));
        console.log(chalk.white(`📊 TOTAL TRANSAKSI: ${transactions.length}`));

        if (transactions.length === 0) {
          throw new Error('❌ TIDAK ADA WALLET DENGAN SALDO TOKEN YANG CUKUP');
        }

        // Preview
        await previewTransactions(transactions, tokenSymbol);

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
            format: '📤 PROGRESS |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} TRANSACTIONS',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
          });
          
          progressBar.start(transactions.length, 0);
          console.log(); // Tambahkan baris kosong setelah progress bar
          
          for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            console.log(chalk.cyan(`\n🔄 EKSEKUSI ${i+1}/${transactions.length}: ${shortenAddress(tx.from)} → ${shortenAddress(tx.to)}`));
            
            try {
              const wallet = getWallet(tx.privateKey, provider);
              
              await sendTokenWithRetry(wallet, tokenContract, tx.to, tx.amount, explorer, tokenSymbol, baseGasPrice);
              progressBar.update(i + 1);
              console.log(); // Tambahkan baris kosong setelah update progress bar
              
              // Tambahkan delay antar transaksi (1-2 detik) - dipercepat
              const delay = Math.floor(Math.random() * 1000) + 1000;
              console.log(chalk.gray(`⏳ MENUNGGU ${delay/1000} DETIK SEBELUM TRANSAKSI BERIKUTNYA...`));
              await new Promise(resolve => setTimeout(resolve, delay));
              console.log(); // Tambahkan baris kosong setelah delay
            } catch (error) {
              log.error(`❌ GAGAL: ${error.message.toUpperCase()}`);
              progressBar.update(i + 1);
              console.log(); // Tambahkan baris kosong setelah error
            }
          }
          
          progressBar.stop();
          console.log(); // Tambahkan baris kosong setelah progress bar selesai
          log.big('✅ SEMUA TRANSAKSI SELESAI');
        } else {
          log.warning('⚠️ TRANSAKSI DIBATALKAN');
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
        console.log(chalk.cyan('\n📤 MODE: SATU ADDRESS → BANYAK ADDRESS'));
        
        const { senderPk } = await inquirer.prompt([
          {
            type: 'password',
            name: 'senderPk',
            message: chalk.bold.white('🔑 MASUKKAN PRIVATE KEY PENGIRIM (ATAU TEKAN ENTER UNTUK .ENV):'),
            default: process.env.PRIVATE_KEY || '',
            mask: '*'
          }
        ]);

        const wallet = getWallet(senderPk, provider);
        const senderAddress = await wallet.getAddress();
        
        console.log(chalk.white(`👤 PENGIRIM: ${shortenAddress(senderAddress)}`));

        // Gunakan alamat dari file address.txt
        if (addressList.length === 0) {
          throw new Error('❌ TIDAK ADA ALAMAT PENERIMA YANG VALID DI ADDRESS.TXT');
        }
        
        const recipients = addressList;
        console.log(chalk.white(`👥 JUMLAH PENERIMA: ${recipients.length}`));
        
        // Input amount
        const amountOptions = [
          '🔄 KIRIM SEMUA SALDO',
          '💰 TENTUKAN NOMINAL'
        ];
        const amountOptionIndex = await selectMode('💸 PILIH JUMLAH', amountOptions);
        const amountOption = amountOptionIndex === 0 ? 'all' : 'fixed';

        let amountPerRecipient;
        if (amountOption === 'fixed') {
          const { amountInput } = await inquirer.prompt([
            {
              type: 'input',
              name: 'amountInput',
              message: chalk.bold.white(`💰 MASUKKAN JUMLAH ${symbol.toUpperCase()} PER PENERIMA:`),
              validate: input => !isNaN(input) && parseFloat(input) > 0 || '❌ JUMLAH TIDAK VALID!'
            }
          ]);
          amountPerRecipient = ethers.parseEther(amountInput);
        } else {
          // Hitung saldo per penerima
          const balance = await provider.getBalance(senderAddress);
          // Kurangi biaya gas
          const gasFee = baseGasPrice * ethers.toBigInt(21000); // Gunakan gas limit dengan buffer
          amountPerRecipient = (balance - gasFee * ethers.toBigInt(recipients.length)) / ethers.toBigInt(recipients.length);
          console.log(chalk.white(`💱 SALDO PER PENERIMA: ${ethers.formatEther(amountPerRecipient)} ${symbol.toUpperCase()}`));
        }

        const totalAmount = amountPerRecipient * ethers.toBigInt(recipients.length);

        // Cek saldo
        const balance = await provider.getBalance(senderAddress);
        const estimatedGasCost = baseGasPrice * ethers.toBigInt(21000) * ethers.toBigInt(recipients.length);
        
        if (balance < totalAmount + estimatedGasCost) {
          throw new Error(`❌ SALDO TIDAK CUKUP! DIBUTUHKAN: ${ethers.formatEther(totalAmount + estimatedGasCost)} ${symbol.toUpperCase()}, TERSEDIA: ${ethers.formatEther(balance)} ${symbol.toUpperCase()}`);
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
            gasPrice: baseGasPrice
          });
        }

        // Preview
        await previewTransactions(transactions);

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
            format: '📤 PROGRESS |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} TRANSACTIONS',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
          });
          
          progressBar.start(transactions.length, 0);
          console.log(); // Tambahkan baris kosong setelah progress bar
          
          for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            console.log(chalk.cyan(`\n🔄 EKSEKUSI ${i+1}/${transactions.length}: ${shortenAddress(tx.from)} → ${shortenAddress(tx.to)}`));
            
            try {
              await sendNativeWithRetry(wallet, tx.to, tx.amount, explorer, symbol, baseGasPrice);
              progressBar.update(i + 1);
              console.log(); // Tambahkan baris kosong setelah update progress bar
              
              // Tambahkan delay antar transaksi (1-2 detik) - dipercepat
              const delay = Math.floor(Math.random() * 1000) + 1000;
              console.log(chalk.gray(`⏳ MENUNGGU ${delay/1000} DETIK SEBELUM TRANSAKSI BERIKUTNYA...`));
              await new Promise(resolve => setTimeout(resolve, delay));
              console.log(); // Tambahkan baris kosong setelah delay
            } catch (error) {
              log.error(`❌ GAGAL: ${error.message.toUpperCase()}`);
              progressBar.update(i + 1);
              console.log(); // Tambahkan baris kosong setelah error
            }
          }
          
          progressBar.stop();
          console.log(); // Tambahkan baris kosong setelah progress bar selesai
          log.big('✅ SEMUA TRANSAKSI SELESAI');
        } else {
          log.warning('⚠️ TRANSAKSI DIBATALKAN');
        }
      } else {
        // Kirim native token ke satu address dari banyak wallet
        console.log(chalk.cyan('\n📥 MODE: BANYAK ADDRESS → SATU ADDRESS'));
        
        const { recipientAddress } = await inquirer.prompt([
          {
            type: 'input',
            name: 'recipientAddress',
            message: chalk.bold.white('📝 MASUKKAN ALAMAT PENERIMA:'),
            validate: input => ethers.isAddress(input) || '❌ ALAMAT TIDAK VALID!'
          }
        ]);
        
        console.log(chalk.white(`👤 PENERIMA: ${shortenAddress(recipientAddress)}`));

        const amountOptions = [
          '🔄 KIRIM SEMUA SALDO',
          '💰 TENTUKAN NOMINAL'
        ];
        const amountOptionIndex = await selectMode('💸 PILIH JUMLAH', amountOptions);
        const amountOption = amountOptionIndex === 0 ? 'all' : 'fixed';

        let amountPerWallet;
        if (amountOption === 'fixed') {
          const { amountInput } = await inquirer.prompt([
            {
              type: 'input',
              name: 'amountInput',
              message: chalk.bold.white(`💰 MASUKKAN JUMLAH ${symbol.toUpperCase()} PER WALLET:`),
              validate: input => !isNaN(input) && parseFloat(input) > 0 || '❌ JUMLAH TIDAK VALID!'
            }
          ]);
          amountPerWallet = ethers.parseEther(amountInput);
        }

        // Prepare transactions dengan pemrosesan paralel
        console.log(chalk.gray('-'.repeat(50)));
        const transactions = await processWalletsInParallel(
          provider, 
          privateKeyList, 
          amountOption, 
          amountPerWallet, 
          recipientAddress, 
          symbol,
          baseGasPrice
        );
        console.log(chalk.gray('-'.repeat(50)));
        console.log(chalk.white(`📊 TOTAL TRANSAKSI: ${transactions.length}`));

        if (transactions.length === 0) {
          throw new Error('❌ TIDAK ADA WALLET DENGAN SALDO YANG CUKUP UNTUK BIAYA GAS');
        }

        // Preview
        await previewTransactions(transactions);

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
            format: '📤 PROGRESS |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} TRANSACTIONS',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
          });
          
          progressBar.start(transactions.length, 0);
          console.log(); // Tambahkan baris kosong setelah progress bar
          
          for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            console.log(chalk.cyan(`\n🔄 EKSEKUSI ${i+1}/${transactions.length}: ${shortenAddress(tx.from)} → ${shortenAddress(tx.to)}`));
            
            try {
              const wallet = getWallet(tx.privateKey, provider);
              
              await sendNativeWithRetry(wallet, tx.to, tx.amount, explorer, symbol, baseGasPrice);
              progressBar.update(i + 1);
              console.log(); // Tambahkan baris kosong setelah update progress bar
              
              // Tambahkan delay antar transaksi (1-2 detik) - dipercepat
              const delay = Math.floor(Math.random() * 1000) + 1000;
              console.log(chalk.gray(`⏳ MENUNGGU ${delay/1000} DETIK SEBELUM TRANSAKSI BERIKUTNYA...`));
              await new Promise(resolve => setTimeout(resolve, delay));
              console.log(); // Tambahkan baris kosong setelah delay
            } catch (error) {
              log.error(`❌ GAGAL: ${error.message.toUpperCase()}`);
              progressBar.update(i + 1);
              console.log(); // Tambahkan baris kosong setelah error
            }
          }
          
          progressBar.stop();
          console.log(); // Tambahkan baris kosong setelah progress bar selesai
          log.big('✅ SEMUA TRANSAKSI SELESAI');
        } else {
          log.warning('⚠️ TRANSAKSI DIBATALKAN');
        }
      }
    }
  } catch (error) {
    log.error(`❌ ERROR: ${error.message.toUpperCase()}`);
    process.exit(1);
  }
}

main();
