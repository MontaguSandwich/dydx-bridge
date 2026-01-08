#!/usr/bin/env node
/**
 * Test Script: Verify Skip Go Fast Route via Osmosis
 *
 * This script tests:
 * 1. Skip API route from dYdX → Arbitrum with go_fast enabled
 * 2. Whether the route goes through Osmosis FastTransfer contract
 * 3. What the expected path/operations are
 *
 * Run: node scripts/test-skip-go-fast.js
 */

const SKIP_API_URL = 'https://api.skip.build/v2';

// Known configurations
const CONFIG = {
  dydx: {
    chainId: 'dydx-mainnet-1',
    usdcDenom: 'ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5'
  },
  osmosis: {
    chainId: 'osmosis-1',
    fastTransferContract: 'osmo1vy34lpt5zlj797w7zqdta3qfq834kapx88qtgudy7jgljztj567s73ny82',
    hyperlaneDomain: 875,
    usdcDenom: 'ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4'
  },
  arbitrum: {
    chainId: '42161',
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    hyperlaneDomain: 42161
  }
};

async function testRoute(options = {}) {
  const {
    amount = '10000000', // 10 USDC
    goFast = true,
    bridges = ['CCTP', 'IBC', 'GO_FAST']
  } = options;

  console.log('\n📡 Testing Skip API Route...');
  console.log(`   Amount: ${amount} (${parseInt(amount) / 1e6} USDC)`);
  console.log(`   go_fast: ${goFast}`);
  console.log(`   bridges: ${bridges.join(', ')}`);

  try {
    const response = await fetch(`${SKIP_API_URL}/fungible/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_asset_denom: CONFIG.dydx.usdcDenom,
        source_asset_chain_id: CONFIG.dydx.chainId,
        dest_asset_denom: CONFIG.arbitrum.usdcAddress,
        dest_asset_chain_id: CONFIG.arbitrum.chainId,
        amount_in: amount,
        go_fast: goFast,
        bridges: bridges,
        smart_relay: true
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ API Error:', response.status, error);
      return null;
    }

    const route = await response.json();
    return route;
  } catch (err) {
    console.error('❌ Request failed:', err.message);
    return null;
  }
}

function analyzeRoute(route) {
  if (!route) return;

  console.log('\n📊 Route Analysis:');
  console.log('─'.repeat(60));

  // Basic route info
  console.log(`   Source: ${route.source_asset_chain_id}`);
  console.log(`   Destination: ${route.dest_asset_chain_id}`);
  console.log(`   Amount In: ${route.amount_in} (${parseInt(route.amount_in) / 1e6} USDC)`);
  console.log(`   Amount Out: ${route.amount_out} (${parseInt(route.amount_out) / 1e6} USDC)`);
  console.log(`   Estimated Time: ${route.estimated_route_duration_seconds}s`);

  // Check for Go Fast
  const usesGoFast = route.does_swap === false &&
    route.operations?.some(op =>
      op.go_fast_transfer ||
      op.transfer?.bridge_id === 'GO_FAST'
    );

  console.log(`   Uses Go Fast: ${usesGoFast ? '✅ Yes' : '❌ No'}`);

  // Analyze operations
  console.log('\n📋 Operations:');
  if (route.operations && route.operations.length > 0) {
    route.operations.forEach((op, i) => {
      console.log(`\n   Step ${i + 1}:`);

      if (op.transfer) {
        console.log(`   Type: Transfer`);
        console.log(`   From: ${op.transfer.from_chain_id}`);
        console.log(`   To: ${op.transfer.to_chain_id}`);
        console.log(`   Bridge: ${op.transfer.bridge_id || 'IBC'}`);
        if (op.transfer.dest_denom) {
          console.log(`   Dest Denom: ${op.transfer.dest_denom.substring(0, 50)}...`);
        }
      }

      if (op.go_fast_transfer) {
        console.log(`   Type: GO_FAST Transfer ⚡`);
        console.log(`   From: ${op.go_fast_transfer.from_chain_id}`);
        console.log(`   To: ${op.go_fast_transfer.to_chain_id}`);
        console.log(`   Fee BPS: ${op.go_fast_transfer.fee_bps || 'N/A'}`);
      }
    });
  }

  // Check if Osmosis is in the path
  const chainPath = route.chain_ids || [];
  const osmosisInPath = chainPath.includes('osmosis-1');
  console.log(`\n   Chain Path: ${chainPath.join(' → ')}`);
  console.log(`   Osmosis in path: ${osmosisInPath ? '✅ Yes' : '❌ No'}`);

  // Required chain addresses
  if (route.required_chain_addresses) {
    console.log('\n📍 Required Addresses:');
    route.required_chain_addresses.forEach(addr => {
      console.log(`   ${addr}`);
    });
  }

  return {
    usesGoFast,
    osmosisInPath,
    chainPath,
    estimatedTime: route.estimated_route_duration_seconds,
    amountOut: route.amount_out
  };
}

async function testOsmosisContract() {
  console.log('\n🔍 Querying Osmosis FastTransfer Contract...');

  const contractAddr = CONFIG.osmosis.fastTransferContract;
  const queryUrl = `https://lcd.osmosis.zone/cosmwasm/wasm/v1/contract/${contractAddr}/smart`;

  // Query supported domains
  const queries = [
    { name: 'Config', msg: { config: {} } },
    { name: 'Remote Domains', msg: { remote_domains: {} } }
  ];

  for (const q of queries) {
    try {
      const encodedMsg = Buffer.from(JSON.stringify(q.msg)).toString('base64');
      const response = await fetch(`${queryUrl}/${encodedMsg}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`\n   ${q.name}:`);
        console.log(JSON.stringify(data.data, null, 2).split('\n').map(l => '   ' + l).join('\n'));
      } else {
        console.log(`   ${q.name}: Query failed (${response.status})`);
      }
    } catch (err) {
      console.log(`   ${q.name}: Error - ${err.message}`);
    }
  }
}

async function main() {
  console.log('═'.repeat(60));
  console.log('   SKIP GO FAST ROUTE TESTER');
  console.log('   Testing dYdX → Arbitrum with Go Fast');
  console.log('═'.repeat(60));

  // Test 1: Route with go_fast enabled
  console.log('\n🧪 Test 1: Route with go_fast=true');
  const goFastRoute = await testRoute({ goFast: true });
  const goFastAnalysis = analyzeRoute(goFastRoute);

  // Test 2: Route without go_fast (comparison)
  console.log('\n🧪 Test 2: Route with go_fast=false (comparison)');
  const normalRoute = await testRoute({ goFast: false, bridges: ['CCTP', 'IBC'] });
  const normalAnalysis = analyzeRoute(normalRoute);

  // Test 3: Query Osmosis contract directly
  await testOsmosisContract();

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('   SUMMARY');
  console.log('═'.repeat(60));

  if (goFastAnalysis && normalAnalysis) {
    console.log(`\n   Go Fast Route:`);
    console.log(`   ├── Uses Go Fast: ${goFastAnalysis.usesGoFast ? '✅' : '❌'}`);
    console.log(`   ├── Via Osmosis: ${goFastAnalysis.osmosisInPath ? '✅' : '❌'}`);
    console.log(`   ├── Time: ~${goFastAnalysis.estimatedTime}s`);
    console.log(`   └── Output: ${parseInt(goFastAnalysis.amountOut) / 1e6} USDC`);

    console.log(`\n   Normal Route:`);
    console.log(`   ├── Time: ~${normalAnalysis.estimatedTime}s`);
    console.log(`   └── Output: ${parseInt(normalAnalysis.amountOut) / 1e6} USDC`);

    if (goFastAnalysis.usesGoFast && goFastAnalysis.osmosisInPath) {
      console.log('\n   ✅ CONFIRMED: Go Fast routes through Osmosis!');
      console.log('   This validates our solver architecture.');
    }
  } else {
    console.log('\n   ⚠️  Could not complete all tests. Check network connectivity.');
  }

  console.log('\n' + '═'.repeat(60));
}

main().catch(console.error);
