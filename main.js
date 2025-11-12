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
  console.log(chalk.green(`✅ Ditemukan ${addressList.length} alamat penerima unik di address.txt`));
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
    case 8453: return '🔵'; // Base
    case 33139: return '🐒'; // ApeChain
    default: return '💾';
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

// Fungsi untuk mendapatkan provider dengan fallback
function getProvider(network) {
  // Normalisasi konfigurasi RPC
  const rpcUrls = network.rpcUrls || [network.rpcUrl || network.endpoint];
  
  // Buat provider untuk setiap URL
  const providers = rpcUrls.map(url => {
    console.log(chalk.gray(`🔗 Menghubungkan ke: ${url}`));
    return new ethers.JsonRpcProvider(url);
  });
  
  return {
    // Fungsi dengan fallback untuk getBalance
    getBalance: async (address) => {
      for (const provider of providers) {
        try {
          return await provider.getBalance(address);
        } catch (error) {
          console.log(chalk.yellow(`⚠️ RPC ${provider._connection.url} gagal, mencoba endpoint lain...`));
          continue;
        }
      }
      throw new Error('Semua endpoint RPC gagal');
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
      throw new Error('Semua endpoint RPC gagal');
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
      throw new Error('Semua endpoint RPC gagal');
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
      throw new Error('Semua endpoint RPC gagal');
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
      throw new Error('Semua endpoint RPC gagal');
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
      throw new Error('Semua endpoint RPC gagal');
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
      throw new Error('Semua endpoint RPC gagal');
    },
    
    // Kembalikan provider utama untuk digunakan oleh wallet
    getMainProvider: () => providers[0]
  };
}

// Fungsi untuk mendapatkan wallet
function getWallet(privateKey, provider) {
  return new ethers.Wallet(privateKey, provider.getMainProvider());
}

// Fungsi untuk mengirim native token dengan retry yang ditingkatkan (diperbaiki total)
async function sendNativeWithRetry(wallet, to, amount, explorer, symbol, maxRetries = 5) {
  let nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
  
  // Gunakan gas price default dari jaringan tanpa markup
  let gasPrice = await wallet.provider.getFeeData().then(fd => fd.gasPrice);
  
  // Estimasi gas limit dengan buffer
  let gasLimit;
  try {
    gasLimit = await wallet.provider.estimateGas({
      to: to,
      value: amount,
      from: wallet.address
    });
    // Tambahkan buffer 30% untuk keamanan
    gasLimit = gasLimit * ethers.toBigInt(130) / ethers.toBigInt(100);
  } catch (error) {
    console.log(chalk.yellow(`⚠️ Estimasi gas gagal, menggunakan default`));
    gasLimit = ethers.toBigInt(30000); // Default dengan buffer lebih besar
  }
  
  // Pastikan saldo cukup untuk transaksi
  const balance = await wallet.provider.getBalance(wallet.address);
  const gasFee = gasPrice * gasLimit;
  const totalNeeded = amount + gasFee;
  
  // Cek saldo dengan cadangan tambahan
  if (balance < totalNeeded) {
    throw new Error(`Saldo tidak cukup! Dibutuhkan: ${ethers.formatEther(totalNeeded)} ${symbol} (termasuk gas), Tersedia: ${ethers.formatEther(balance)} ${symbol}`);
  }
  
  for (let i = 0; i < maxRetries; i++) {
    // Buat spinner di luar try-catch
    const spinner = ora('⏳ Mengirim transaksi...').start();
    
    try {
      const tx = {
        to: to,
        value: amount,
        nonce: nonce,
        gasPrice: gasPrice,
        gasLimit: gasLimit
      };

      console.log(chalk.gray(`📊 Gas Limit: ${gasLimit.toString()}, Gas Price: ${ethers.formatUnits(gasPrice, 'gwei')} Gwei`));
      console.log(chalk.gray(`💰 Amount: ${ethers.formatEther(amount)} ${symbol}, Gas Fee: ${ethers.formatEther(gasFee)} ${symbol}`));

      // Tambahkan timeout untuk transaksi
      const txResponse = await Promise.race([
        wallet.sendTransaction(tx),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Transaction timeout')), 30000)
        )
      ]);
      
      spinner.succeed(`✅ Transaksi terkirim: ${txResponse.hash}`);
      
      log.tx(`HASH: ${txResponse.hash}`);
      log.explorer(txResponse.hash, explorer);
      
      return txResponse;
    } catch (error) {
      spinner.fail(`❌ Gagal: ${error.message}`);
      
      if (error.message.includes('nonce too low')) {
        log.warning(`Nonce terlalu rendah, mencoba lagi... (${i + 1}/${maxRetries})`);
        nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
      } else if (error.message.includes('replacement fee too low') || error.message.includes('gas price too low')) {
        log.warning(`Fee terlalu rendah, menaikkan gas price... (${i + 1}/${maxRetries})`);
        // Tambahkan 15% ke gas price setiap retry
        gasPrice = (gasPrice * ethers.toBigInt(115)) / ethers.toBigInt(100);
      } else if (error.message.includes('insufficient funds')) {
        log.error(`Saldo tidak cukup untuk transaksi`);
        throw error;
      } else if (error.message.includes('intrinsic gas')) {
        log.warning(`Masalah gas limit, menaikkan gas limit... (${i + 1}/${maxRetries})`);
        // Tambahkan 30% ke gas limit
        gasLimit = (gasLimit * ethers.toBigInt(130)) / ethers.toBigInt(100);
        // Tunggu sebelum mencoba lagi
        await new Promise(resolve => setTimeout(resolve, 3000));
        // Dapatkan nonce dan gas price terbaru
        nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
        gasPrice = await wallet.provider.getFeeData().then(fd => fd.gasPrice);
      } else if (error.code === -32000 || error.message.includes('could not coalesce')) {
        log.warning(`Masalah koneksi RPC, mencoba lagi... (${i + 1}/${maxRetries})`);
        // Tunggu lebih lama untuk masalah koneksi
        await new Promise(resolve => setTimeout(resolve, 5000));
        // Dapatkan nonce dan gas price terbaru
        nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
        gasPrice = await wallet.provider.getFeeData().then(fd => fd.gasPrice);
      } else {
        log.error(`Error tidak terduga: ${error.message}`);
        if (i === maxRetries - 1) throw error;
      }
      
      // Tunggu sebelum mencoba lagi
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  throw new Error('Max retries reached');
}

// Fungsi untuk mengirim token dengan retry yang ditingkatkan
async function sendTokenWithRetry(wallet, tokenContract, to, amount, explorer, symbol, maxRetries = 5) {
  let nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
  
  // Gunakan gas price default dari jaringan tanpa markup
  let gasPrice = await wallet.provider.getFeeData().then(fd => fd.gasPrice);
  
  for (let i = 0; i < maxRetries; i++) {
    // Buat spinner di luar try-catch
    const spinner = ora('⏳ Mengirim transaksi...').start();
    
    try {
      const tx = await tokenContract.transfer.populateTransaction(to, amount);
      tx.nonce = nonce;
      tx.gasPrice = gasPrice;
      
      // Estimasi gas limit
      let gasLimit = await wallet.provider.estimateGas(tx);
      // Tambahkan buffer 30% untuk keamanan
      gasLimit = gasLimit * ethers.toBigInt(130) / ethers.toBigInt(100);
      tx.gasLimit = gasLimit;

      console.log(chalk.gray(`📊 Gas Limit: ${gasLimit.toString()}, Gas Price: ${ethers.formatUnits(gasPrice, 'gwei')} Gwei`));

      // Tambahkan timeout untuk transaksi
      const txResponse = await Promise.race([
        wallet.sendTransaction(tx),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Transaction timeout')), 30000)
        )
      ]);
      
      spinner.succeed(`✅ Transaksi terkirim: ${txResponse.hash}`);
      
      log.tx(`HASH: ${txResponse.hash}`);
      log.explorer(txResponse.hash, explorer);
      
      return txResponse;
    } catch (error) {
      spinner.fail(`❌ Gagal: ${error.message}`);
      
      if (error.message.includes('nonce too low')) {
        log.warning(`Nonce terlalu rendah, mencoba lagi... (${i + 1}/${maxRetries})`);
        nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
      } else if (error.message.includes('replacement fee too low') || error.message.includes('gas price too low')) {
        log.warning(`Fee terlalu rendah, menaikkan gas price... (${i + 1}/${maxRetries})`);
        // Tambahkan 15% ke gas price setiap retry
        gasPrice = (gasPrice * ethers.toBigInt(115)) / ethers.toBigInt(100);
      } else if (error.message.includes('insufficient funds')) {
        log.error(`Saldo tidak cukup untuk transaksi`);
        throw error;
      } else if (error.message.includes('intrinsic gas')) {
        log.warning(`Masalah gas limit, menaikkan gas limit... (${i + 1}/${maxRetries})`);
        // Tunggu sebelum mencoba lagi
        await new Promise(resolve => setTimeout(resolve, 3000));
        // Dapatkan nonce dan gas price terbaru
        nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
        gasPrice = await wallet.provider.getFeeData().then(fd => fd.gasPrice);
      } else if (error.code === -32000 || error.message.includes('could not coalesce')) {
        log.warning(`Masalah koneksi RPC, mencoba lagi... (${i + 1}/${maxRetries})`);
        // Tunggu lebih lama untuk masalah koneksi
        await new Promise(resolve => setTimeout(resolve, 5000));
        // Dapatkan nonce dan gas price terbaru
        nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
        gasPrice = await wallet.provider.getFeeData().then(fd => fd.gasPrice);
      } else {
        log.error(`Error tidak terduga: ${error.message}`);
        if (i === maxRetries - 1) throw error;
      }
      
      // Tunggu sebelum mencoba lagi
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  throw new Error('Max retries reached');
}

// Fungsi untuk preview transaksi
async function previewTransactions(transactions, nativeSymbol) {
  log.header('📋 PREVIEW TRANSAKSI');
  let totalGas = ethers.toBigInt(0);
  let totalAmount = ethers.toBigInt(0);
  
  console.log(chalk.gray('='.repeat(80)));
  
  for (const tx of transactions) {
    console.log(chalk.white(`DARI     : ${shortenAddress(tx.from)}`));
    console.log(chalk.white(`KE       : ${shortenAddress(tx.to)}`));
    const decimals = tx.decimals || 18;
    const amount = ethers.formatUnits(tx.amount, decimals);
    console.log(chalk.white(`JUMLAH   : ${amount} ${tx.symbol}`));
    console.log(chalk.white(`GAS      : ${tx.gasLimit} units`));
    console.log(chalk.white(`GAS PRICE: ${ethers.formatUnits(tx.gasPrice, 'gwei')} Gwei`));
    console.log(chalk.gray('-'.repeat(80)));
    totalGas += ethers.toBigInt(tx.gasLimit) * ethers.toBigInt(tx.gasPrice);
    totalAmount += tx.amount;
  }
  
  console.log(chalk.yellow(`💰 TOTAL JUMLAH: ${ethers.formatUnits(totalAmount, 18)} ${nativeSymbol}`));
  console.log(chalk.yellow(`💰 TOTAL ESTIMASI GAS FEE: ${ethers.formatEther(totalGas)} ${nativeSymbol}`));
  console.log(chalk.gray('='.repeat(80)));
}

// Fungsi untuk memproses wallet secara paralel (diperbaiki total)
async function processWalletsInParallel(provider, privateKeyList, amountOption, amountPerWallet, recipientAddress, symbol) {
  const batchSize = 10; // Proses 10 wallet sekaligus
  const results = [];
  
  console.log(chalk.white(`🔄 Memproses ${privateKeyList.length} wallet secara paralel...`));
  
  // Create progress bar for wallet processing
  const progressBar = new cliProgress.SingleBar({
    format: '🔄 Processing Wallets |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} Wallets',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });
  
  progressBar.start(privateKeyList.length, 0);
  
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
            reason: 'Mengirim ke diri sendiri'
          };
        }
        
        const balance = await provider.getBalance(senderAddress);
        const gasPrice = await provider.getFeeData().then(fd => fd.gasPrice);
        
        // Estimasi gas limit yang lebih akurat
        let gasLimit;
        try {
          // Untuk estimasi, gunakan nilai yang lebih realistis
          const estimatedGas = await provider.estimateGas({
            to: recipientAddress,
            value: ethers.toBigInt(1000000000000000000), // 1 ETH untuk estimasi
            from: senderAddress
          });
          // Tambahkan buffer 30% untuk keamanan
          gasLimit = estimatedGas * ethers.toBigInt(130) / ethers.toBigInt(100);
        } catch (error) {
          console.log(chalk.yellow(`⚠️ Estimasi gas gagal untuk ${shortenAddress(senderAddress)}, menggunakan default`));
          gasLimit = ethers.toBigInt(30000); // Default dengan buffer lebih besar
        }
        
        const gasFee = gasPrice * gasLimit;
        
        let amount;
        if (amountOption === 'all') {
          // Untuk opsi "all", kirim semua saldo kecuali biaya gas
          // Tapi pastikan ada sisa minimal untuk biaya gas
          const minReserve = gasFee * ethers.toBigInt(2); // Cadangan 2x biaya gas
          if (balance <= minReserve) {
            return {
              success: false,
              address: senderAddress,
              reason: 'Saldo terlalu kecil'
            };
          }
          amount = balance - gasFee;
          
          // Pastikan amount tidak terlalu kecil
          if (amount < ethers.toBigInt(1000000000000000)) { // 0.001 ETH minimum
            return {
              success: false,
              address: senderAddress,
              reason: 'Saldo terlalu kecil setelah dikurangi biaya gas'
            };
          }
        } else {
          // Untuk opsi "fixed", gunakan jumlah yang ditentukan
          amount = amountPerWallet;
          
          // Pastikan saldo cukup untuk amount + gasFee + cadangan
          const totalNeeded = amount + gasFee + gasFee; // Tambah cadangan 1x gas fee
          if (balance < totalNeeded) {
            return {
              success: false,
              address: senderAddress,
              reason: 'Saldo tidak cukup'
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
            gasPrice: gasPrice
          };
        } else {
          return {
            success: false,
            address: senderAddress,
            reason: 'Saldo tidak cukup'
          };
        }
      } catch (error) {
        return {
          success: false,
          address: 'unknown',
          reason: `Error: ${error.message}`
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    progressBar.update(i + batch.length);
  }
  
  progressBar.stop();
  
  // Tampilkan ringkasan
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(chalk.green(`✅ ${successful.length} wallet siap untuk transaksi`));
  console.log(chalk.yellow(`⚠️ ${failed.length} wallet dilewati`));
  
  // Tampilkan detail wallet yang gagal (hanya 5 pertama untuk menghindari spam)
  if (failed.length > 0) {
    console.log(chalk.gray('\nDetail wallet yang dilewati (hanya 5 pertama):'));
    failed.slice(0, 5).forEach((result, index) => {
      console.log(chalk.yellow(`   ${index + 1}. ${shortenAddress(result.address)} - ${result.reason}`));
    });
    if (failed.length > 5) {
      console.log(chalk.gray(`   ... dan ${failed.length - 5} lainnya`));
    }
  }
  
  return successful;
}

// Fungsi untuk memproses wallet token secara paralel
async function processTokenWalletsInParallel(provider, privateKeyList, tokenContract, amountOption, amountPerWallet, recipientAddress, tokenSymbol) {
  const batchSize = 10; // Proses 10 wallet sekaligus
  const results = [];
  
  console.log(chalk.white(`🔄 Memproses ${privateKeyList.length} wallet secara paralel...`));
  
  // Create progress bar for wallet processing
  const progressBar = new cliProgress.SingleBar({
    format: '🔄 Processing Wallets |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} Wallets',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });
  
  progressBar.start(privateKeyList.length, 0);
  
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
            reason: 'Mengirim ke diri sendiri'
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
          const gasPrice = await provider.getFeeData().then(fd => fd.gasPrice);
          
          // Estimasi gas limit yang lebih akurat
          let gasLimit = ethers.toBigInt(100000); // Default dengan buffer
          try {
            const estimatedGas = await provider.estimateGas({
              to: tokenContract.target,
              data: tokenContract.interface.encodeFunctionData('transfer', [recipientAddress, amount]),
              from: senderAddress
            });
            // Tambahkan buffer 30% untuk keamanan
            gasLimit = estimatedGas * ethers.toBigInt(130) / ethers.toBigInt(100);
          } catch (error) {
            console.log(chalk.yellow(`⚠️ Estimasi gas gagal untuk ${shortenAddress(senderAddress)}, menggunakan default`));
          }
          
          const gasFee = gasPrice * gasLimit;
          
          if (nativeBalance < gasFee) {
            return {
              success: false,
              address: senderAddress,
              reason: 'Saldo native token tidak cukup untuk biaya gas'
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
            gasPrice: gasPrice
          };
        } else {
          return {
            success: false,
            address: senderAddress,
            reason: 'Saldo token tidak cukup'
          };
        }
      } catch (error) {
        return {
          success: false,
          address: 'unknown',
          reason: `Error: ${error.message}`
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    progressBar.update(i + batch.length);
  }
  
  progressBar.stop();
  
  // Tampilkan ringkasan
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(chalk.green(`✅ ${successful.length} wallet siap untuk transaksi`));
  console.log(chalk.yellow(`⚠️ ${failed.length} wallet dilewati`));
  
  // Tampilkan detail wallet yang gagal (hanya 5 pertama untuk menghindari spam)
  if (failed.length > 0) {
    console.log(chalk.gray('\nDetail wallet yang dilewati (hanya 5 pertama):'));
    failed.slice(0, 5).forEach((result, index) => {
      console.log(chalk.yellow(`   ${index + 1}. ${shortenAddress(result.address)} - ${result.reason}`));
    });
    if (failed.length > 5) {
      console.log(chalk.gray(`   ... dan ${failed.length - 5} lainnya`));
    }
  }
  
  return successful;
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
    const provider = getProvider(network);
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
      ], provider.getMainProvider());

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

        // Cek saldo token
        const balance = await tokenContract.balanceOf(senderAddress);
        if (balance < totalAmount) {
          throw new Error(`❌ Saldo token tidak cukup! Dibutuhkan: ${ethers.formatUnits(totalAmount, tokenDecimals)} ${tokenSymbol}, Tersedia: ${ethers.formatUnits(balance, tokenDecimals)} ${tokenSymbol}`);
        }

        // Cek saldo native token untuk biaya gas
        const nativeBalance = await provider.getBalance(senderAddress);
        const gasPrice = await provider.getFeeData().then(fd => fd.gasPrice);
        const estimatedGasCost = gasPrice * ethers.toBigInt(100000) * ethers.toBigInt(recipients.length);
        
        if (nativeBalance < estimatedGasCost) {
          throw new Error(`❌ Saldo native token tidak cukup untuk biaya gas! Dibutuhkan: ${ethers.formatEther(estimatedGasCost)} ${symbol}, Tersedia: ${ethers.formatEther(nativeBalance)} ${symbol}`);
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
            gasPrice: gasPrice
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
              await sendTokenWithRetry(wallet, tokenContract, tx.to, tx.amount, explorer, symbol);
              log.success(`✅ BERHASIL: ${ethers.formatUnits(tx.amount, tokenDecimals)} ${tokenSymbol} → ${shortenAddress(tx.to)}`);
              progressBar.update(i + 1);
              
              // Tambahkan delay antar transaksi (3-7 detik)
              const delay = Math.floor(Math.random() * 4000) + 3000;
              console.log(chalk.gray(`⏳ Menunggu ${delay/1000} detik sebelum transaksi berikutnya...`));
              await new Promise(resolve => setTimeout(resolve, delay));
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

        // Prepare transactions dengan pemrosesan paralel
        console.log(chalk.gray('-'.repeat(50)));
        const transactions = await processTokenWalletsInParallel(
          provider, 
          privateKeyList, 
          tokenContract, 
          amountOption, 
          amountPerWallet, 
          recipientAddress, 
          tokenSymbol
        );
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
              
              await sendTokenWithRetry(wallet, tokenContract, tx.to, tx.amount, explorer, symbol);
              log.success(`✅ BERHASIL: ${ethers.formatUnits(tx.amount, tx.decimals)} ${tokenSymbol} → ${shortenAddress(tx.to)}`);
              progressBar.update(i + 1);
              
              // Tambahkan delay antar transaksi (3-7 detik)
              const delay = Math.floor(Math.random() * 4000) + 3000;
              console.log(chalk.gray(`⏳ Menunggu ${delay/1000} detik sebelum transaksi berikutnya...`));
              await new Promise(resolve => setTimeout(resolve, delay));
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
          // Kurangi biaya gas
          const gasPrice = await provider.getFeeData().then(fd => fd.gasPrice);
          const gasFee = gasPrice * ethers.toBigInt(30000); // Gunakan gas limit dengan buffer
          amountPerRecipient = (balance - gasFee * ethers.toBigInt(recipients.length)) / ethers.toBigInt(recipients.length);
          console.log(chalk.white(`💱 Saldo per penerima: ${ethers.formatEther(amountPerRecipient)} ${symbol}`));
        }

        const totalAmount = amountPerRecipient * ethers.toBigInt(recipients.length);

        // Cek saldo
        const balance = await provider.getBalance(senderAddress);
        const gasPrice = await provider.getFeeData().then(fd => fd.gasPrice);
        const estimatedGasCost = gasPrice * ethers.toBigInt(30000) * ethers.toBigInt(recipients.length);
        
        if (balance < totalAmount + estimatedGasCost) {
          throw new Error(`❌ Saldo tidak cukup! Dibutuhkan: ${ethers.formatEther(totalAmount + estimatedGasCost)} ${symbol}, Tersedia: ${ethers.formatEther(balance)} ${symbol}`);
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
            gasLimit: 30000,
            gasPrice: gasPrice
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
              await sendNativeWithRetry(wallet, tx.to, tx.amount, explorer, symbol);
              log.success(`✅ BERHASIL: ${ethers.formatEther(tx.amount)} ${symbol} → ${shortenAddress(tx.to)}`);
              progressBar.update(i + 1);
              
              // Tambahkan delay antar transaksi (3-7 detik)
              const delay = Math.floor(Math.random() * 4000) + 3000;
              console.log(chalk.gray(`⏳ Menunggu ${delay/1000} detik sebelum transaksi berikutnya...`));
              await new Promise(resolve => setTimeout(resolve, delay));
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

        // Prepare transactions dengan pemrosesan paralel
        console.log(chalk.gray('-'.repeat(50)));
        const transactions = await processWalletsInParallel(
          provider, 
          privateKeyList, 
          amountOption, 
          amountPerWallet, 
          recipientAddress, 
          symbol
        );
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
              
              await sendNativeWithRetry(wallet, tx.to, tx.amount, explorer, symbol);
              log.success(`✅ BERHASIL: ${ethers.formatEther(tx.amount)} ${symbol} → ${shortenAddress(tx.to)}`);
              progressBar.update(i + 1);
              
              // Tambahkan delay antar transaksi (3-7 detik)
              const delay = Math.floor(Math.random() * 1500) + 2000;
              console.log(chalk.gray(`⏳ Menunggu ${delay/550} detik sebelum transaksi berikutnya...`));
              await new Promise(resolve => setTimeout(resolve, delay));
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
