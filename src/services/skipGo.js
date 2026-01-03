/**
 * Skip Go API Service
 * Handles dYdX (Cosmos) <-> EVM bridging via CCTP/IBC
 * 
 * Docs: https://docs.skip.build
 */

const SKIP_API_URL = 'https://api.skip.build/v2';

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

/**
 * Get supported chains from Skip
 */
export async function getChains() {
  const response = await fetch(`${SKIP_API_URL}/info/chains`);
  if (!response.ok) throw new Error('Failed to fetch chains');
  return response.json();
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

  const response = await fetch(`${SKIP_API_URL}/fungible/route`, {
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
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch route');
  }

  return response.json();
}

/**
 * Get transaction messages for a route
 */
export async function getMessages(route, addresses) {
  const response = await fetch(`${SKIP_API_URL}/fungible/msgs`, {
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
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get messages');
  }

  return response.json();
}

/**
 * Get transaction status
 */
export async function getStatus(txHash, chainId) {
  const response = await fetch(`${SKIP_API_URL}/tx/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tx_hash: txHash,
      chain_id: chainId
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get status');
  }

  return response.json();
}

/**
 * Poll for transaction completion
 */
export async function waitForCompletion(txHash, chainId, maxAttempts = 60, intervalMs = 5000) {
  for (let i = 0; i < maxAttempts; i++) {
    const status = await getStatus(txHash, chainId);
    
    if (status.state === 'STATE_COMPLETED_SUCCESS') {
      return { success: true, status };
    }
    
    if (status.state === 'STATE_COMPLETED_ERROR' || status.state === 'STATE_ABANDONED') {
      return { success: false, status, error: status.error };
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error('Transaction timed out');
}

export default {
  getChains,
  getRoute,
  getMessages,
  getStatus,
  waitForCompletion,
  SKIP_CONFIG
};
