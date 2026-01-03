/**
 * LI.FI API Service
 * Handles Arbitrum -> Hyperliquid bridging
 * 
 * Docs: https://docs.li.fi
 */

const LIFI_API_URL = 'https://li.quest/v1';

// Chain and token configuration
export const LIFI_CONFIG = {
  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum',
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
  },
  hyperliquid: {
    chainId: 'hyperliquid', // LI.FI uses custom identifier
    name: 'Hyperliquid',
    bridgeAddress: '0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7'
  }
};

/**
 * Get quote for Arbitrum -> Hyperliquid bridge
 */
export async function getQuote(amountIn, fromAddress, options = {}) {
  const {
    fromChain = LIFI_CONFIG.arbitrum.chainId,
    toChain = 'hyperliquid',
    fromToken = LIFI_CONFIG.arbitrum.usdcAddress,
    toToken = LIFI_CONFIG.arbitrum.usdcAddress,
    order = 'FASTEST', // FASTEST, CHEAPEST, SAFEST
    slippage = 0.5
  } = options;

  const params = new URLSearchParams({
    fromChain: String(fromChain),
    toChain: toChain,
    fromToken: fromToken,
    toToken: toToken,
    fromAmount: amountIn,
    fromAddress: fromAddress,
    order: order,
    slippage: String(slippage / 100)
  });

  const response = await fetch(`${LIFI_API_URL}/quote?${params}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get quote');
  }

  return response.json();
}

/**
 * Get available routes (for comparison)
 */
export async function getRoutes(amountIn, fromAddress, options = {}) {
  const {
    fromChain = LIFI_CONFIG.arbitrum.chainId,
    toChain = 'hyperliquid',
    fromToken = LIFI_CONFIG.arbitrum.usdcAddress,
    toToken = LIFI_CONFIG.arbitrum.usdcAddress
  } = options;

  const response = await fetch(`${LIFI_API_URL}/advanced/routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromChainId: fromChain,
      fromAmount: amountIn,
      fromTokenAddress: fromToken,
      fromAddress: fromAddress,
      toChainId: toChain,
      toTokenAddress: toToken,
      options: {
        order: 'RECOMMENDED',
        slippage: 0.005,
        maxPriceImpact: 0.4
      }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get routes');
  }

  return response.json();
}

/**
 * Get transaction status
 */
export async function getStatus(txHash, fromChain, toChain) {
  const params = new URLSearchParams({
    txHash: txHash,
    bridge: 'hyperliquid',
    fromChain: String(fromChain),
    toChain: toChain
  });

  const response = await fetch(`${LIFI_API_URL}/status?${params}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get status');
  }

  return response.json();
}

/**
 * Poll for transaction completion
 */
export async function waitForCompletion(txHash, fromChain, toChain, maxAttempts = 60, intervalMs = 5000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const status = await getStatus(txHash, fromChain, toChain);
      
      if (status.status === 'DONE') {
        return { success: true, status };
      }
      
      if (status.status === 'FAILED') {
        return { success: false, status, error: status.substatus || 'Transaction failed' };
      }
    } catch (err) {
      // Status endpoint might not be immediately available
      console.log('Status check pending...', i + 1);
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error('Transaction status check timed out');
}

/**
 * Get supported chains
 */
export async function getChains() {
  const response = await fetch(`${LIFI_API_URL}/chains`);
  if (!response.ok) throw new Error('Failed to fetch chains');
  return response.json();
}

/**
 * Get supported tokens for a chain
 */
export async function getTokens(chainId) {
  const response = await fetch(`${LIFI_API_URL}/tokens?chains=${chainId}`);
  if (!response.ok) throw new Error('Failed to fetch tokens');
  return response.json();
}

export default {
  getQuote,
  getRoutes,
  getStatus,
  waitForCompletion,
  getChains,
  getTokens,
  LIFI_CONFIG
};
