/**
 * Skip Go API Service
 * Handles dYdX (Cosmos) <-> EVM bridging via CCTP/IBC
 *
 * Docs: https://docs.skip.build
 */

import { retry, fetchWithTimeout, parseErrorResponse, formatUserError } from './retry.js';

const SKIP_API_URL = 'https://api.skip.build/v2';
const REQUEST_TIMEOUT_MS = 30000;

// Chain IDs and token denoms
export const SKIP_CONFIG = {
  dydx: {
    chainId: 'dydx-mainnet-1',
    usdcDenom: 'ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5',
    rpc: 'https://dydx-rpc.polkachu.com'
  },
  noble: {
    chainId: 'noble-1',
    usdcDenom: 'uusdc'
  },
  arbitrum: {
    chainId: '42161',
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
  }
};

// Retry configuration for Skip API calls
const RETRY_OPTIONS = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  onRetry: (error, attempt, delay) => {
    console.log(`Skip API retry attempt ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}`);
  }
};

/**
 * Get supported chains from Skip
 */
export async function getChains() {
  return retry(async () => {
    const response = await fetchWithTimeout(
      `${SKIP_API_URL}/info/chains`,
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
      console.log(`Skip getChains retry ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}`);
    }
  });
}

/**
 * Get route from dYdX to Arbitrum
 */
export async function getRoute(amountIn, options = {}) {
  const {
    sourceChain = SKIP_CONFIG.dydx.chainId,
    destChain = SKIP_CONFIG.arbitrum.chainId,
    sourceDenom = SKIP_CONFIG.dydx.usdcDenom,
    destDenom = SKIP_CONFIG.arbitrum.usdcAddress,
    bridges = ['CCTP', 'IBC', 'AXELAR'],
    goFast = true
  } = options;

  return retry(async () => {
    const response = await fetchWithTimeout(
      `${SKIP_API_URL}/fungible/route`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_asset_denom: sourceDenom,
          source_asset_chain_id: sourceChain,
          dest_asset_denom: destDenom,
          dest_asset_chain_id: destChain,
          amount_in: amountIn,
          cumulative_affiliate_fee_bps: '0',
          allow_unsafe: true,
          smart_relay: true,
          go_fast: goFast,
          bridges,
          smart_swap_options: {
            split_routes: false,
            evm_swaps: true
          }
        })
      },
      REQUEST_TIMEOUT_MS
    );

    if (!response.ok) {
      const error = await parseErrorResponse(response);
      error.message = formatUserError(error, 'Failed to fetch route');
      throw error;
    }

    const data = await response.json();

    // Validate response contains required fields
    if (!data.source_asset_chain_id || !data.operations) {
      const error = new Error('Invalid route response from Skip API');
      error.data = data;
      throw error;
    }

    return data;
  }, {
    ...RETRY_OPTIONS,
    onRetry: (error, attempt, delay) => {
      console.log(`Skip getRoute retry ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}`);
    }
  });
}

/**
 * Get transaction messages for a route
 */
export async function getMessages(route, addresses) {
  return retry(async () => {
    const response = await fetchWithTimeout(
      `${SKIP_API_URL}/fungible/msgs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_asset_denom: route.source_asset_denom,
          source_asset_chain_id: route.source_asset_chain_id,
          dest_asset_denom: route.dest_asset_denom,
          dest_asset_chain_id: route.dest_asset_chain_id,
          amount_in: route.amount_in,
          amount_out: route.amount_out,
          address_list: addresses,
          operations: route.operations,
          slippage_tolerance_percent: '1'
        })
      },
      REQUEST_TIMEOUT_MS
    );

    if (!response.ok) {
      const error = await parseErrorResponse(response);
      error.message = formatUserError(error, 'Failed to build transaction');
      throw error;
    }

    return response.json();
  }, {
    ...RETRY_OPTIONS,
    onRetry: (error, attempt, delay) => {
      console.log(`Skip getMessages retry ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}`);
    }
  });
}

/**
 * Get transaction status
 */
export async function getStatus(txHash, chainId) {
  return retry(async () => {
    const response = await fetchWithTimeout(
      `${SKIP_API_URL}/tx/status`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_hash: txHash,
          chain_id: chainId
        })
      },
      REQUEST_TIMEOUT_MS
    );

    if (!response.ok) {
      const error = await parseErrorResponse(response);
      error.message = formatUserError(error, 'Failed to check transaction status');
      throw error;
    }

    return response.json();
  }, {
    ...RETRY_OPTIONS,
    maxAttempts: 2, // Status checks should fail faster
    onRetry: (error, attempt, delay) => {
      console.log(`Skip getStatus retry ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}`);
    }
  });
}

/**
 * Poll for transaction completion with exponential backoff
 */
export async function waitForCompletion(txHash, chainId, maxAttempts = 60, initialIntervalMs = 5000) {
  let intervalMs = initialIntervalMs;
  const maxIntervalMs = 15000; // Cap at 15 seconds between polls
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 5;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const status = await getStatus(txHash, chainId);
      consecutiveErrors = 0; // Reset on success

      if (status.state === 'STATE_COMPLETED_SUCCESS') {
        return { success: true, status };
      }

      if (status.state === 'STATE_COMPLETED_ERROR' || status.state === 'STATE_ABANDONED') {
        return {
          success: false,
          status,
          error: status.error || 'Transaction failed or was abandoned'
        };
      }

      // Gradually increase polling interval (backoff)
      intervalMs = Math.min(intervalMs * 1.2, maxIntervalMs);

    } catch (err) {
      consecutiveErrors++;
      console.warn(`Status check failed (attempt ${i + 1}/${maxAttempts}): ${err.message}`);

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

export default {
  getChains,
  getRoute,
  getMessages,
  getStatus,
  waitForCompletion,
  SKIP_CONFIG
};
