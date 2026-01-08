# MVP TODO: dYdX → Hyperliquid Solver

**Goal**: Functional solver for small personal transfers (< $1,000 USDC)

**Architecture** (simplified for MVP):
```
dYdX → IBC → Osmosis (FastTransfer) → Solver → Hyperliquid (usdSend)
                                         ↓
                              Settlement on Osmosis (async)
```

---

## Phase 0: Validation (Before Writing Code)

### 0.1 Verify Skip Go Fast Route
- [ ] Test Skip API returns go_fast route from dYdX → Arbitrum
  ```bash
  curl -X POST https://api.skip.build/v2/fungible/route \
    -H "Content-Type: application/json" \
    -d '{
      "source_asset_denom": "ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5",
      "source_asset_chain_id": "dydx-mainnet-1",
      "dest_asset_denom": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      "dest_asset_chain_id": "42161",
      "amount_in": "100000000",
      "go_fast": true
    }'
  ```
- [ ] Confirm route includes Osmosis in chain path
- [ ] Note the IBC memo format returned

### 0.2 Query Osmosis FastTransfer Contract
- [ ] Query contract config
  ```bash
  # Contract: osmo1vy34lpt5zlj797w7zqdta3qfq834kapx88qtgudy7jgljztj567s73ny82
  # Check supported destination domains (need 42161 for Arbitrum)
  ```
- [ ] Verify contract accepts custom destination_domain values
- [ ] Understand the submitOrder message schema

### 0.3 Test Hyperliquid usdSend
- [ ] Create test wallet on Hyperliquid
- [ ] Fund with small USDC amount (~$100)
- [ ] Test usdSend to another address you control
- [ ] Verify instant transfer, no gas cost
- [ ] Document nonce management requirements

---

## Phase 1: Hyperliquid Client (2-3 days)

### 1.1 Project Setup
- [ ] Create Go module: `github.com/[you]/hl-solver`
- [ ] Set up project structure:
  ```
  hl-solver/
  ├── cmd/
  │   └── solver/main.go
  ├── pkg/
  │   ├── hyperliquid/     # HL API client
  │   ├── osmosis/         # Osmosis client
  │   └── config/          # Configuration
  ├── config/
  │   ├── config.yaml
  │   └── keys.json
  └── go.mod
  ```

### 1.2 Hyperliquid Client
- [ ] Implement EIP-712 signing for Hyperliquid
  - [ ] Domain separator (chainId: 42161)
  - [ ] UsdSend type hash
  - [ ] Sign function
- [ ] Implement `usdSend(destination, amount)`
- [ ] Implement `getBalance()` to check USDC balance
- [ ] Implement nonce tracking
- [ ] Test: Send $1 USDC between two addresses you control

### 1.3 Hyperliquid Client Tests
- [ ] Unit test for EIP-712 signature generation
- [ ] Integration test against real HL API (testnet if available)

---

## Phase 2: Osmosis Monitor (2-3 days)

### 2.1 Osmosis Connection
- [ ] Set up CosmWasm client (cosmwasm-go or grpc)
- [ ] Connect to Osmosis RPC/gRPC endpoints
- [ ] Query FastTransfer contract state

### 2.2 Event Subscription
- [ ] Subscribe to contract events (OrderSubmitted)
- [ ] Parse event data:
  - [ ] order_id
  - [ ] sender
  - [ ] recipient
  - [ ] amount_in / amount_out
  - [ ] destination_domain
  - [ ] data field
- [ ] Filter for destination_domain == 1000000 (our custom Hyperliquid domain)
  - OR destination_domain == 42161 with "HL:" prefix (if using fallback approach)

### 2.3 Event Processing
- [ ] Validate order parameters
- [ ] Check solver has sufficient HL inventory
- [ ] Queue order for fulfillment

---

## Phase 3: Fulfillment Engine (2-3 days)

### 3.1 Basic Fulfiller
- [ ] Receive order from monitor
- [ ] Extract recipient HL address
- [ ] Call `usdSend(recipient, amount_out)`
- [ ] Log fulfillment result
- [ ] Store in SQLite:
  - order_id
  - fill_timestamp
  - hl_tx_response
  - status

### 3.2 Inventory Check
- [ ] Before fulfilling, check HL balance >= amount_out
- [ ] If insufficient, skip order (log warning)
- [ ] Simple threshold: don't fill if balance would drop below $100

### 3.3 Error Handling
- [ ] Retry usdSend on transient errors (max 3 attempts)
- [ ] Mark order as failed after max retries
- [ ] Don't double-fill (check if already fulfilled)

---

## Phase 4: Settlement (3-4 days)

### 4.1 Settlement Queue
- [ ] Track fulfilled orders pending settlement
- [ ] Batch orders for gas efficiency (or settle individually for MVP)

### 4.2 Initiate Settlement
- [ ] Call `initiateSettlement` on Osmosis FastTransfer contract
- [ ] Include order_ids to settle
- [ ] Monitor transaction confirmation

### 4.3 Settlement Completion
- [ ] Monitor Hyperlane relay status
- [ ] Verify funds received on Osmosis
- [ ] Update database: order settled
- [ ] For MVP: Manual verification is OK

---

## Phase 5: MVP Integration (2-3 days)

### 5.1 Configuration
- [ ] Create config.yaml with:
  ```yaml
  osmosis:
    rpc: "https://osmosis-rpc.polkachu.com"
    grpc: "osmosis-grpc.polkachu.com:443"
    fast_transfer_contract: "osmo1vy34lpt5zlj..."

  hyperliquid:
    api_url: "https://api.hyperliquid.xyz"
    # Private key loaded from env or encrypted file

  solver:
    destination_domain: 1000000  # Custom HL domain
    min_fill_amount: 5000000     # $5 USDC minimum
    max_fill_amount: 1000000000  # $1000 USDC maximum (MVP limit)
    min_inventory: 100000000     # Keep $100 USDC buffer
  ```

### 5.2 Main Loop
- [ ] Start Osmosis event subscription
- [ ] Process incoming orders
- [ ] Execute fulfillments
- [ ] Queue settlements
- [ ] Graceful shutdown handling

### 5.3 Logging & Debugging
- [ ] Structured logging (JSON format)
- [ ] Log levels: DEBUG for dev, INFO for prod
- [ ] Log all order/fill/settlement events

---

## Phase 6: End-to-End Test (1-2 days)

### 6.1 Test Setup
- [ ] Fund solver wallet on Hyperliquid ($200 USDC)
- [ ] Fund test wallet on dYdX ($50 USDC)
- [ ] Start solver

### 6.2 Manual E2E Test
- [ ] Submit intent from dYdX (use Skip API directly or existing frontend)
  - Small amount: $10 USDC
  - Destination: Your test HL address
  - Custom domain or HL: prefix
- [ ] Watch solver logs for order detection
- [ ] Verify HL balance increases
- [ ] Verify settlement completes

### 6.3 Edge Cases
- [ ] Test with amount below minimum → should skip
- [ ] Test with amount above maximum → should skip
- [ ] Test when inventory is low → should skip
- [ ] Test duplicate order → should not double-fill

---

## MVP Checklist Summary

```
□ Phase 0: Validation
  □ Skip API returns go_fast route via Osmosis
  □ Osmosis contract supports our use case
  □ Hyperliquid usdSend works

□ Phase 1: Hyperliquid Client
  □ EIP-712 signing
  □ usdSend implementation
  □ Balance checking

□ Phase 2: Osmosis Monitor
  □ Event subscription
  □ Order parsing
  □ Filtering for our intents

□ Phase 3: Fulfillment
  □ Execute usdSend for valid orders
  □ Inventory management
  □ Error handling

□ Phase 4: Settlement
  □ Initiate settlement on Osmosis
  □ Track settlement status

□ Phase 5: Integration
  □ Config management
  □ Main loop
  □ Logging

□ Phase 6: E2E Test
  □ Successful transfer: dYdX → HL
  □ Settlement completes
```

---

## MVP Scope Exclusions (Do Later)

- ❌ Automatic rebalancing (manually top up HL for MVP)
- ❌ Multiple concurrent orders (process one at a time)
- ❌ Fancy monitoring/alerting (just logs)
- ❌ High availability / redundancy
- ❌ Rate limiting (single user testing)
- ❌ Profit tracking (just get it working)
- ❌ Reverse flow (HL → dYdX)
- ❌ Sub-account support
- ❌ Frontend modifications

---

## Capital Required for MVP

| Location | Amount | Purpose |
|----------|--------|---------|
| Hyperliquid | $500 USDC | Fulfillment inventory |
| Osmosis | ~$10 OSMO | Gas for settlement txs |
| dYdX | $50 USDC | Test transfers |
| **Total** | **~$560** | |

---

## Estimated Timeline

| Phase | Days | Cumulative |
|-------|------|------------|
| 0. Validation | 1 | 1 |
| 1. HL Client | 2-3 | 4 |
| 2. Osmosis Monitor | 2-3 | 7 |
| 3. Fulfillment | 2-3 | 10 |
| 4. Settlement | 3-4 | 14 |
| 5. Integration | 2-3 | 17 |
| 6. E2E Test | 1-2 | **~19 days** |

---

## Quick Start Commands

```bash
# Clone skip-go-fast-solver as reference
git clone https://github.com/skip-mev/skip-go-fast-solver
cd skip-go-fast-solver
cat config/sample/config.yml  # Study the config structure

# Create your solver project
mkdir hl-solver && cd hl-solver
go mod init github.com/[you]/hl-solver

# Start with Hyperliquid client
mkdir -p pkg/hyperliquid
# Implement EIP-712 signing first...
```

---

## Key Files to Study

1. **Skip Go Fast Solver** (reference implementation):
   - `orderfulfiller/` - How fills work
   - `transfermonitor/` - How to watch for orders
   - `shared/config/config.go` - Configuration structure

2. **Go Fast Contracts**:
   - `cosmwasm/contracts/fast-transfer-gateway/` - Contract interface
   - Understand `submit_order` and `initiate_settlement` messages

3. **Hyperliquid**:
   - [API Docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint)
   - `usdSend` action format
   - EIP-712 signing requirements
