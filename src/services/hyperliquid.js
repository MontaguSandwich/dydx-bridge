/**
 * Hyperliquid Bridge Service
 * Handles direct USDC deposits from Arbitrum to Hyperliquid HyperCore
 * 
 * Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/bridge2
 */

import { ethers } from 'ethers';

// Bridge contract addresses
export const HL_CONFIG = {
  mainnet: {
    bridgeAddress: '0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7',
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
  },
  testnet: {
    bridgeAddress: '0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89',
    usdcAddress: '0x...' // Testnet USDC
  }
};

// ERC20 ABI (minimal for approve and transfer)
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  // Permit for gasless approvals
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external',
  'function nonces(address owner) external view returns (uint256)',
  'function DOMAIN_SEPARATOR() external view returns (bytes32)'
];

// Bridge2 ABI (minimal)
const BRIDGE_ABI = [
  'function batchedDepositWithPermit((address user, uint64 usd, uint64 deadline, (bytes32 r, bytes32 s, uint8 v) signature)[] deposits) external'
];

/**
 * Get USDC balance on Arbitrum
 */
export async function getUsdcBalance(address, provider, isMainnet = true) {
  const config = isMainnet ? HL_CONFIG.mainnet : HL_CONFIG.testnet;
  const usdc = new ethers.Contract(config.usdcAddress, ERC20_ABI, provider);
  const balance = await usdc.balanceOf(address);
  return ethers.formatUnits(balance, 6);
}

/**
 * Check USDC allowance for bridge
 */
export async function checkAllowance(ownerAddress, provider, isMainnet = true) {
  const config = isMainnet ? HL_CONFIG.mainnet : HL_CONFIG.testnet;
  const usdc = new ethers.Contract(config.usdcAddress, ERC20_ABI, provider);
  const allowance = await usdc.allowance(ownerAddress, config.bridgeAddress);
  return ethers.formatUnits(allowance, 6);
}

/**
 * Approve USDC spending for bridge (if needed)
 */
export async function approveUsdc(signer, amount, isMainnet = true) {
  const config = isMainnet ? HL_CONFIG.mainnet : HL_CONFIG.testnet;
  const usdc = new ethers.Contract(config.usdcAddress, ERC20_ABI, signer);
  
  const amountWei = ethers.parseUnits(amount.toString(), 6);
  const tx = await usdc.approve(config.bridgeAddress, amountWei);
  await tx.wait();
  
  return tx.hash;
}

/**
 * Simple deposit: transfer USDC directly to bridge
 * The bridge will credit the sender's Hyperliquid account
 */
export async function depositToBridge(signer, amount, isMainnet = true) {
  const config = isMainnet ? HL_CONFIG.mainnet : HL_CONFIG.testnet;
  const usdc = new ethers.Contract(config.usdcAddress, ERC20_ABI, signer);
  
  const amountWei = ethers.parseUnits(amount.toString(), 6);
  
  // Simple transfer to bridge address
  const tx = await usdc.transfer(config.bridgeAddress, amountWei);
  const receipt = await tx.wait();
  
  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber
  };
}

/**
 * Generate EIP-2612 permit signature for gasless deposit
 * This allows depositing without a separate approve transaction
 */
export async function signPermit(signer, amount, deadline, isMainnet = true) {
  const config = isMainnet ? HL_CONFIG.mainnet : HL_CONFIG.testnet;
  const address = await signer.getAddress();
  const provider = signer.provider;
  
  const usdc = new ethers.Contract(config.usdcAddress, ERC20_ABI, provider);
  
  // Get nonce and domain separator
  const nonce = await usdc.nonces(address);
  const domainSeparator = await usdc.DOMAIN_SEPARATOR();
  
  const amountWei = ethers.parseUnits(amount.toString(), 6);
  
  // EIP-2612 Permit type data
  const domain = {
    name: isMainnet ? 'USD Coin' : 'USDC2',
    version: isMainnet ? '2' : '1',
    chainId: 42161, // Arbitrum
    verifyingContract: config.usdcAddress
  };
  
  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' }
    ]
  };
  
  const value = {
    owner: address,
    spender: config.bridgeAddress,
    value: amountWei,
    nonce: nonce,
    deadline: deadline
  };
  
  const signature = await signer.signTypedData(domain, types, value);
  const sig = ethers.Signature.from(signature);
  
  return {
    v: sig.v,
    r: sig.r,
    s: sig.s,
    deadline,
    amount: amountWei.toString()
  };
}

/**
 * Deposit with permit (gasless approve)
 * Note: This uses the batched deposit function
 */
export async function depositWithPermit(signer, amount, deadline, isMainnet = true) {
  const config = isMainnet ? HL_CONFIG.mainnet : HL_CONFIG.testnet;
  const address = await signer.getAddress();
  
  // Sign the permit
  const permit = await signPermit(signer, amount, deadline, isMainnet);
  
  // Create deposit payload
  const deposit = {
    user: address,
    usd: ethers.parseUnits(amount.toString(), 6),
    deadline: deadline,
    signature: {
      r: permit.r,
      s: permit.s,
      v: permit.v
    }
  };
  
  // Call batched deposit
  const bridge = new ethers.Contract(config.bridgeAddress, BRIDGE_ABI, signer);
  const tx = await bridge.batchedDepositWithPermit([deposit]);
  const receipt = await tx.wait();
  
  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber
  };
}

/**
 * Estimate gas for deposit
 */
export async function estimateDepositGas(provider, amount, isMainnet = true) {
  const config = isMainnet ? HL_CONFIG.mainnet : HL_CONFIG.testnet;
  const usdc = new ethers.Contract(config.usdcAddress, ERC20_ABI, provider);
  
  const amountWei = ethers.parseUnits(amount.toString(), 6);
  
  // Estimate gas for transfer
  const gasEstimate = await usdc.transfer.estimateGas(config.bridgeAddress, amountWei);
  const gasPrice = await provider.getFeeData();
  
  const gasCost = gasEstimate * gasPrice.gasPrice;
  
  return {
    gasLimit: gasEstimate.toString(),
    gasPrice: ethers.formatUnits(gasPrice.gasPrice, 'gwei'),
    estimatedCost: ethers.formatEther(gasCost)
  };
}

/**
 * Watch for deposit confirmation on Hyperliquid
 * Note: This polls the Hyperliquid info API
 */
export async function waitForHyperliquidCredit(address, expectedAmount, maxAttempts = 30, intervalMs = 2000) {
  const infoUrl = 'https://api.hyperliquid.xyz/info';
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(infoUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'clearinghouseState',
          user: address
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        // Check if balance increased
        const balance = parseFloat(data.marginSummary?.accountValue || '0');
        if (balance >= expectedAmount * 0.99) { // 1% tolerance
          return { success: true, balance };
        }
      }
    } catch (err) {
      console.log('Waiting for Hyperliquid credit...', i + 1);
    }
    
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  return { success: false, error: 'Timeout waiting for credit' };
}

export default {
  getUsdcBalance,
  checkAllowance,
  approveUsdc,
  depositToBridge,
  signPermit,
  depositWithPermit,
  estimateDepositGas,
  waitForHyperliquidCredit,
  HL_CONFIG
};
