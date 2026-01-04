/**
 * LI.FI API Service
 * Handles Arbitrum -> Hyperliquid bridging
 *
 * Docs: https://docs.li.fi
 */

import { retry, fetchWithTimeout, parseErrorResponse, formatUserError } from './retry.js';

const LIFI_API_URL = 'https://li.quest/v1';
const REQUEST_TIMEOUT_MS = 30000;

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

// Retry configuration for LI.FI API calls
const RETRY_OPTIONS = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  onRetry: (error, attempt, delay) => {
    console.log(`LI.FI API retry attempt ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}`);
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

  return retry(async () => {
    const response = await fetchWithTimeout(
      `${LIFI_API_URL}/quote?${params}`,
      {},
      REQUEST_TIMEOUT_MS
    );

    if (!response.ok) {
      const error = await parseErrorResponse(response);
      error.message = formatUserError(error, 'Failed to get bridge quote');
      throw error;
    }

    return response.json();
  }, {
    ...RETRY_OPTIONS,
    onRetry: (error, attempt, delay) => {
      console.log(`LI.FI getQuote retry ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}`);
    }
  });
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

  return retry(async () => {
    const response = await fetchWithTimeout(
      `${LIFI_API_URL}/advanced/routes`,
      {
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
      },
      REQUEST_TIMEOUT_MS
    );

    if (!response.ok) {
      const error = await parseErrorResponse(response);
      error.message = formatUserError(error, 'Failed to get bridge routes');
      throw error;
    }

    return response.json();
  }, {
    ...RETRY_OPTIONS,
    onRetry: (error, attempt, delay) => {
      console.log(`LI.FI getRoutes retry ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}`);
    }
  });
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

  return retry(async () => {
    const response = await fetchWithTimeout(
      `${LIFI_API_URL}/status?${params}`,
      {},
      REQUEST_TIMEOUT_MS
    );

    if (!response.ok) {
      const error = await parseErrorResponse(response);
      error.message = formatUserError(error, 'Failed to get transaction status');
      throw error;
    }

    return response.json();
  }, {
    ...RETRY_OPTIONS,
    maxAttempts: 2, // Status checks should fail faster
    onRetry: (error, attempt, delay) => {
      console.log(`LI.FI getStatus retry ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}`);
    }
  });
}

/**
 * Poll for transaction completion with exponential backoff
 */
export async function waitForCompletion(txHash, fromChain, toChain, maxAttempts = 60, initialIntervalMs = 5000) {
  let intervalMs = initialIntervalMs;
  const maxIntervalMs = 15000; // Cap at 15 seconds between polls
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 5;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const status = await getStatus(txHash, fromChain, toChain);
      consecutiveErrors = 0; // Reset on success

      if (status.status === 'DONE') {
        return { success: true, status };
      }

      if (status.status === 'FAILED') {
        return {
          success: false,
          status,
          error: status.substatus || status.message || 'Transaction failed'
        };
      }

      // Gradually increase polling interval (backoff)
      intervalMs = Math.min(intervalMs * 1.2, maxIntervalMs);

    } catch (err) {
      consecutiveErrors++;
      // Status endpoint might not be immediately available - this is expected behavior
      console.log(`LI.FI status check pending (${i + 1}/${maxAttempts}): ${err.message}`);

      // If we've had too many consecutive errors, fail fast
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw new Error(`Failed to check transaction status after ${maxConsecutiveErrors} consecutive errors: ${err.message}`);
      }

      // Use longer interval after errors
      intervalMs = Math.min(intervalMs * 1.5, maxIntervalMs);
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Transaction status check timed out after ${maxAttempts} attempts. Your transaction may still complete - check the explorer.`);
}

/**
 * Get supported chains
 */
export async function getChains() {
  return retry(async () => {
    const response = await fetchWithTimeout(
      `${LIFI_API_URL}/chains`,
      {},
      REQUEST_TIMEOUT_MS
    );

    if (!response.ok) {
      throw await parseErrorResponse(response);
    }

    return response.json();
  }, {
    ...RETRY_OPTIONS,
    onRetry: (error, attempt, delay) => {
      console.log(`LI.FI getChains retry ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}`);
    }
  });
}

/**
 * Get supported tokens for a chain
 */
export async function getTokens(chainId) {
  return retry(async () => {
    const response = await fetchWithTimeout(
      `${LIFI_API_URL}/tokens?chains=${chainId}`,
      {},
      REQUEST_TIMEOUT_MS
    );

    if (!response.ok) {
      throw await parseErrorResponse(response);
    }

    return response.json();
  }, {
    ...RETRY_OPTIONS,
    onRetry: (error, attempt, delay) => {
      console.log(`LI.FI getTokens retry ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}`);
    }
  });
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
