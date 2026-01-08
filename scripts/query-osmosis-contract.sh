#!/bin/bash
# Query Osmosis FastTransfer Contract
# This script queries the Skip Go Fast contract on Osmosis to verify:
# 1. The contract exists and is queryable
# 2. What remote domains (destination chains) are supported
# 3. Contract configuration

CONTRACT="osmo1vy34lpt5zlj797w7zqdta3qfq834kapx88qtgudy7jgljztj567s73ny82"
LCD="https://lcd.osmosis.zone"

echo "═══════════════════════════════════════════════════════════════"
echo "   OSMOSIS FASTTRANSFER CONTRACT QUERY"
echo "   Contract: ${CONTRACT:0:20}...${CONTRACT: -10}"
echo "═══════════════════════════════════════════════════════════════"

# Helper function to query contract
query_contract() {
    local name=$1
    local query=$2
    local encoded=$(echo -n "$query" | base64 -w 0 2>/dev/null || echo -n "$query" | base64)

    echo ""
    echo "📋 $name"
    echo "   Query: $query"
    echo ""

    response=$(curl -s --max-time 15 \
        "${LCD}/cosmwasm/wasm/v1/contract/${CONTRACT}/smart/${encoded}")

    if [ $? -eq 0 ] && [ -n "$response" ]; then
        if echo "$response" | grep -q "error"; then
            echo "   ❌ Error: $(echo "$response" | jq -r '.message // .error // .')"
        else
            echo "$response" | jq '.data' 2>/dev/null || echo "$response"
        fi
    else
        echo "   ❌ Request failed"
    fi
}

# Query 1: Contract info (basic check)
echo ""
echo "🔍 Checking contract info..."
curl -s --max-time 15 "${LCD}/cosmwasm/wasm/v1/contract/${CONTRACT}" | jq '.contract_info' 2>/dev/null

# Query 2: Try to get config
query_contract "Config" '{"config":{}}'

# Query 3: Try to get remote domains (supported destinations)
query_contract "Remote Domains" '{"remote_domains":{}}'

# Query 4: Try to get supported destination domains
query_contract "Get All Remote Domains" '{"get_all_remote_domains":{}}'

# Query 5: Check if Arbitrum (42161) is supported
query_contract "Check Arbitrum Domain (42161)" '{"remote_domain":{"domain":42161}}'

# Query 6: Try alternative query format
query_contract "Domain Info" '{"domain_info":{"domain_id":42161}}'

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "   NOTES"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "   If queries fail, the contract may use different query messages."
echo "   Check the go-fast-contracts repo for exact query schema:"
echo "   https://github.com/skip-mev/go-fast-contracts/tree/main/cosmwasm"
echo ""
echo "   Osmosis FastTransfer Contract:"
echo "   $CONTRACT"
echo ""
echo "   View on Celatone:"
echo "   https://celatone.osmosis.zone/osmosis-1/contracts/$CONTRACT"
echo ""
