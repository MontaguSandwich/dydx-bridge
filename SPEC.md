# Skip:Go Fast Solver for dYdX ↔ Hyperliquid

## Executive Summary

A solver-based instant bridge system that enables sub-second USDC transfers between dYdX (Cosmos) and Hyperliquid (HyperCore) by leveraging Skip:Go Fast's intent-based architecture and Hyperliquid's native `usdSend` API.

**Key Innovation**: Instead of routing through Arbitrum for Hyperliquid deposits, the solver maintains USDC inventory directly on Hyperliquid and fulfills user intents via instant internal transfers.

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SOLVER SYSTEM OVERVIEW                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         USER INTERFACE LAYER                          │  │
│  │                                                                       │  │
│  │  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐   │  │
│  │  │   Web Frontend  │    │   SDK/Library   │    │   CLI Tool      │   │  │
│  │  │   (React App)   │    │   (TypeScript)  │    │   (Optional)    │   │  │
│  │  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘   │  │
│  │           └──────────────────────┼──────────────────────┘            │  │
│  └──────────────────────────────────┼───────────────────────────────────┘  │
│                                     │                                       │
│                                     ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      INTENT SUBMISSION LAYER                          │  │
│  │                                                                       │  │
│  │  User signs on dYdX, Skip API routes to Cosmos Hub FastTransfer:      │  │
│  │  • Source: dYdX USDC (IBC'd to Cosmos Hub automatically)              │  │
│  │  • Destination: Arbitrum domain + "HL:" prefix in data field          │  │
│  │  • Amount: X USDC minus solver fee                                    │  │
│  │  • ONE signature from user (Skip API handles multi-hop routing)       │  │
│  │                                                                       │  │
│  └──────────────────────────────────┬───────────────────────────────────┘  │
│                                     │                                       │
│                                     ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         SOLVER SERVICE (Go)                           │  │
│  │                                                                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │  Intent     │  │ Hyperliquid │  │  Inventory  │  │  Settlement │  │  │
│  │  │  Monitor    │  │  Fulfiller  │  │  Manager    │  │  Processor  │  │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │  │
│  │         │                │                │                │         │  │
│  │         ▼                ▼                ▼                ▼         │  │
│  │  ┌───────────────────────────────────────────────────────────────┐   │  │
│  │  │                    Shared State & Database                     │   │  │
│  │  │  • Pending intents    • Fulfilled orders    • Balances        │   │  │
│  │  │  • Settlement queue   • Profit tracking     • Rebalance logs  │   │  │
│  │  └───────────────────────────────────────────────────────────────┘   │  │
│  │                                                                       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                       EXTERNAL INTEGRATIONS                           │  │
│  │                                                                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │ Cosmos Hub  │  │    dYdX     │  │ Hyperliquid │  │  Arbitrum   │  │  │
│  │  │             │  │   Chain     │  │  L1 API     │  │  (Rebal)    │  │  │
│  │  │             │  │             │  │             │  │             │  │  │
│  │  │ FastTransfer│  │  IBC Source │  │  usdSend    │  │  USDC/HL    │  │  │
│  │  │  Contract   │  │  (via Skip) │  │  Endpoint   │  │  Bridge     │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  │                                                                       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. User Flow

### 2.1 dYdX → Hyperliquid (Primary Flow)

**Key Design Decision**: Intent originates on dYdX. User signs ONE transaction via Skip API,
which handles IBC routing to Cosmos Hub (FastTransfer contract) automatically.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: User Initiates Transfer (Frontend)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User Input:                                                                │
│  ├── Amount: 1000 USDC                                                      │
│  ├── Source: dYdX address (dydx1abc...)                                     │
│  ├── Destination: Hyperliquid address (0x123...)                            │
│  └── Fee displayed: ~0.1% (10 bps)                                          │
│                                                                             │
│  Frontend Actions:                                                          │
│  1. Call Skip API with go_fast: true, destination = Cosmos Hub              │
│  2. Skip API returns route: dYdX → IBC → Cosmos Hub (FastTransfer)          │
│  3. Include HL address in intent metadata (data field)                      │
│  4. Display confirmation with fee breakdown                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 2: User Signs Single Transaction on dYdX                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Skip API constructs a multi-message transaction:                           │
│                                                                             │
│  Message 1: IBC MsgTransfer (dYdX → Cosmos Hub)                             │
│  ├── From: dydx1abc... (user's dYdX address)                                │
│  ├── Denom: ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14...    │
│  ├── Amount: 1000000000 (1000 USDC)                                         │
│  └── Memo: Contains FastTransfer intent parameters (via PFM or wasm memo)   │
│                                                                             │
│  The IBC memo encodes the FastTransfer submitOrder call:                    │
│  {                                                                          │
│    "wasm": {                                                                │
│      "contract": "cosmos1<fast_transfer_gateway>",                          │
│      "msg": {                                                               │
│        "submit_order": {                                                    │
│          "recipient": "0x123...",      // User's HL address                 │
│          "amount_out": "999000000",    // After fee                         │
│          "destination_domain": 42161,  // Arbitrum domain (see note below)  │
│          "timeout": 1704672000,                                             │
│          "data": "0x484C3A..."         // "HL:" prefix + metadata           │
│        }                                                                    │
│      }                                                                      │
│    }                                                                        │
│  }                                                                          │
│                                                                             │
│  Signed with: Keplr wallet (ONE signature)                                  │
│  Time: Transaction broadcasts in ~2 seconds                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 3: IBC Relay + FastTransfer Intent Submission (~6-10 seconds)         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Automatic execution via IBC relayers:                                      │
│                                                                             │
│  3a. IBC packet relayed from dYdX → Cosmos Hub                              │
│      └── USDC arrives on Cosmos Hub (~6 seconds)                            │
│                                                                             │
│  3b. IBC memo triggers CosmWasm execution                                   │
│      ├── FastTransfer Gateway contract receives USDC                        │
│      ├── submitOrder executes with encoded parameters                       │
│      └── OrderSubmitted event emitted with unique order_id                  │
│                                                                             │
│  Note: This is atomic - if FastTransfer fails, IBC transfer reverts         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 4: Solver Detects & Fulfills (~1-3 seconds)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Solver Actions:                                                            │
│                                                                             │
│  4a. Intent Monitor detects OrderSubmitted event                            │
│      ├── Validates order parameters                                         │
│      ├── Checks destination_domain == Hyperliquid                           │
│      ├── Verifies amount_out meets minimum threshold                        │
│      └── Confirms sufficient HL inventory                                   │
│                                                                             │
│  4b. Profitability Check                                                    │
│      ├── Fee earned: amount_in - amount_out = 1 USDC                        │
│      ├── Gas cost: ~0 (usdSend is gasless on HL)                            │
│      ├── Settlement cost: ~0.10 USDC (Hyperlane relay)                      │
│      └── Net profit: ~0.90 USDC ✓                                           │
│                                                                             │
│  4c. Execute Fulfillment via Hyperliquid usdSend                            │
│      POST https://api.hyperliquid.xyz/exchange                              │
│      {                                                                      │
│        "action": {                                                          │
│          "type": "usdSend",                                                 │
│          "destination": "0x123...",    // User's HL address                 │
│          "amount": "999.0",            // amount_out                        │
│          "time": 1704672001234                                              │
│        },                                                                   │
│        "nonce": 12345,                                                      │
│        "signature": "0xabc..."         // EIP-712 signature                 │
│      }                                                                      │
│                                                                             │
│  4d. Record fulfillment in database                                         │
│      ├── order_id, fill_timestamp, tx_hash                                  │
│      └── Mark as FULFILLED, queue for settlement                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 5: User Receives USDC on Hyperliquid (INSTANT)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Result:                                                                    │
│  ├── User's Hyperliquid balance: +999 USDC                                  │
│  ├── Available for trading immediately                                      │
│  └── Total time from Step 1: ~10-15 seconds                                 │
│                                                                             │
│  Comparison to Previous System:                                             │
│  ├── Old: 5-10 minutes (CCTP wait + HL deposit)                             │
│  └── New: ~15 seconds (IBC + instant solver fill)                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 6: Solver Settlement (Async, ~10-20 minutes)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Settlement Flow (happens in background):                                   │
│                                                                             │
│  6a. Solver initiates settlement on Noble                                   │
│      ├── Calls initiateSettlement(order_ids[])                              │
│      └── Batches multiple orders for gas efficiency                         │
│                                                                             │
│  6b. Cross-chain verification via Hyperlane                                 │
│      ├── Noble FastTransfer contract sends message                          │
│      ├── Hyperlane validators sign attestation                              │
│      └── Message relayed back to Noble                                      │
│                                                                             │
│  6c. Solver receives funds on Noble                                         │
│      ├── 1000 USDC released from escrow                                     │
│      └── Solver's Noble address credited                                    │
│                                                                             │
│  6d. Rebalancing (if needed)                                                │
│      ├── If HL inventory low: Noble → Arb → HL deposit                      │
│      └── Maintains target inventory levels                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Hyperliquid → dYdX (Reverse Flow)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  REVERSE FLOW: Hyperliquid → dYdX                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STEP 1: User withdraws USDC from Hyperliquid to Arbitrum                   │
│          ├── Uses HL native withdrawal                                      │
│          └── Time: ~2-5 minutes                                             │
│                                                                             │
│  STEP 2: User submits intent on Arbitrum FastTransfer contract              │
│          ├── Destination: dYdX address                                      │
│          └── Solver fee: ~0.1%                                              │
│                                                                             │
│  STEP 3: Solver fulfills on dYdX via IBC from Noble                         │
│          ├── Solver has USDC inventory on Noble                             │
│          ├── IBC transfer Noble → dYdX (~6 seconds)                         │
│          └── User receives on dYdX instantly                                │
│                                                                             │
│  STEP 4: Solver settles on Arbitrum                                         │
│          ├── Receives user's USDC on Arbitrum                               │
│          └── Rebalances to Noble as needed                                  │
│                                                                             │
│  Note: Reverse flow is simpler as Arbitrum has native FastTransfer          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Solver Components

### 3.1 Intent Monitor

```go
// Package: intentmonitor

type IntentMonitor struct {
    // Chain connections
    nobleClient     *cosmosgrpc.Client
    osmosisClient   *cosmosgrpc.Client
    arbitrumClient  *ethclient.Client

    // Contract addresses
    nobleGateway    string
    osmosisGateway  string
    arbitrumGateway common.Address

    // Event processing
    eventChan       chan *OrderSubmittedEvent

    // State
    db              *sql.DB
    logger          *zap.Logger
}

type OrderSubmittedEvent struct {
    OrderID             [32]byte
    Sender              string
    Recipient           string      // For HL orders: user's HL address
    AmountIn            *big.Int
    AmountOut           *big.Int
    DestinationDomain   uint32      // 99999 for Hyperliquid
    TimeoutTimestamp    uint64
    Data                []byte      // Optional metadata
    SourceChain         string      // "noble-1", "osmosis-1", "42161"
    BlockHeight         uint64
    TxHash              string
}

// Core responsibilities:
// 1. Subscribe to OrderSubmitted events on all source chains
// 2. Parse and validate event data
// 3. Filter for Hyperliquid-destined orders (destination_domain == 99999)
// 4. Push valid orders to fulfillment queue
```

### 3.2 Hyperliquid Fulfiller

```go
// Package: hlfulfiller

type HyperliquidFulfiller struct {
    // HL connection
    hlClient        *hyperliquid.Client
    hlPrivateKey    *ecdsa.PrivateKey
    hlAddress       common.Address

    // Configuration
    minProfitBps    uint32          // Minimum profit in basis points
    maxFillAmount   *big.Int        // Maximum single fill amount

    // State
    pendingFills    chan *FillRequest
    db              *sql.DB
    inventoryMgr    *InventoryManager
    logger          *zap.Logger
}

type FillRequest struct {
    Order           *OrderSubmittedEvent
    EstimatedProfit *big.Int
    Priority        int             // Higher = fill first
}

type FillResult struct {
    OrderID         [32]byte
    Success         bool
    TxResponse      *hyperliquid.TxResponse
    FilledAmount    *big.Int
    Error           error
    Timestamp       time.Time
}

// Core responsibilities:
// 1. Evaluate fill profitability
// 2. Check inventory availability
// 3. Execute usdSend to user's HL address
// 4. Record fill in database
// 5. Queue order for settlement
```

### 3.3 Inventory Manager

```go
// Package: inventory

type InventoryManager struct {
    // Wallet connections
    hlClient        *hyperliquid.Client
    nobleClient     *cosmosgrpc.Client
    arbitrumClient  *ethclient.Client

    // Addresses
    hlAddress       common.Address
    nobleAddress    string
    arbitrumAddress common.Address

    // Thresholds (in USDC, 6 decimals)
    hlTargetBalance     *big.Int    // e.g., 100,000 USDC
    hlMinBalance        *big.Int    // e.g., 10,000 USDC - trigger rebalance
    hlMaxBalance        *big.Int    // e.g., 200,000 USDC - withdraw excess
    nobleTargetBalance  *big.Int
    arbTargetBalance    *big.Int

    // State
    balanceCache    map[string]*big.Int
    lastUpdate      time.Time
    rebalanceLock   sync.Mutex
    logger          *zap.Logger
}

type RebalanceAction struct {
    From            string          // "hyperliquid", "noble", "arbitrum"
    To              string
    Amount          *big.Int
    Reason          string
    Priority        int
}

// Core responsibilities:
// 1. Monitor balances across all chains/platforms
// 2. Detect low inventory situations
// 3. Trigger rebalancing flows:
//    - Noble → Arbitrum → Hyperliquid (via CCTP + HL deposit)
//    - Hyperliquid → Arbitrum → Noble (via HL withdraw + CCTP)
// 4. Alert on critical balance levels
```

### 3.4 Settlement Processor

```go
// Package: settlement

type SettlementProcessor struct {
    // Chain clients
    nobleClient     *cosmosgrpc.Client
    osmosisClient   *cosmosgrpc.Client
    arbitrumClient  *ethclient.Client

    // Signing keys
    noblePrivKey    *secp256k1.PrivKey
    arbitrumPrivKey *ecdsa.PrivateKey

    // Configuration
    batchSize       int             // Orders per settlement tx
    batchInterval   time.Duration   // Time between batches

    // State
    pendingQueue    []*FillResult
    db              *sql.DB
    logger          *zap.Logger
}

type SettlementBatch struct {
    OrderIDs        [][32]byte
    SourceChain     string
    TotalAmount     *big.Int
    Status          SettlementStatus
    InitiateTxHash  string
    CompleteTxHash  string
    CreatedAt       time.Time
    CompletedAt     *time.Time
}

type SettlementStatus int
const (
    StatusPending SettlementStatus = iota
    StatusInitiated
    StatusRelaying
    StatusCompleted
    StatusFailed
)

// Core responsibilities:
// 1. Batch fulfilled orders for gas-efficient settlement
// 2. Call initiateSettlement on source chain
// 3. Monitor Hyperlane relay progress
// 4. Verify fund receipt
// 5. Update database and trigger rebalancing if needed
```

---

## 4. Data Models

### 4.1 Database Schema

```sql
-- Orders table: tracks all detected intents
CREATE TABLE orders (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id            BLOB NOT NULL UNIQUE,       -- 32-byte hash
    source_chain        TEXT NOT NULL,              -- "noble-1", "osmosis-1", "42161"
    sender              TEXT NOT NULL,
    recipient           TEXT NOT NULL,              -- User's HL address
    amount_in           TEXT NOT NULL,              -- BigInt as string
    amount_out          TEXT NOT NULL,
    destination_domain  INTEGER NOT NULL,           -- 99999 for HL
    timeout_timestamp   INTEGER NOT NULL,
    data                BLOB,
    block_height        INTEGER NOT NULL,
    tx_hash             TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_destination ON orders(destination_domain);

-- Fills table: tracks solver fulfillments
CREATE TABLE fills (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id            BLOB NOT NULL REFERENCES orders(order_id),
    fill_amount         TEXT NOT NULL,
    hl_tx_response      TEXT,                       -- JSON response from HL
    profit_amount       TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'completed',
    filled_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_fills_order ON fills(order_id);

-- Settlements table: tracks fund recovery
CREATE TABLE settlements (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id            TEXT NOT NULL UNIQUE,
    source_chain        TEXT NOT NULL,
    order_ids           TEXT NOT NULL,              -- JSON array of order_ids
    total_amount        TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',
    initiate_tx_hash    TEXT,
    complete_tx_hash    TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at        DATETIME
);

CREATE INDEX idx_settlements_status ON settlements(status);

-- Balances table: historical balance tracking
CREATE TABLE balances (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    platform            TEXT NOT NULL,              -- "hyperliquid", "noble", "arbitrum"
    address             TEXT NOT NULL,
    token               TEXT NOT NULL,              -- "USDC"
    balance             TEXT NOT NULL,
    recorded_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_balances_platform ON balances(platform, recorded_at);

-- Rebalances table: tracks inventory movements
CREATE TABLE rebalances (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    from_platform       TEXT NOT NULL,
    to_platform         TEXT NOT NULL,
    amount              TEXT NOT NULL,
    reason              TEXT,
    status              TEXT NOT NULL DEFAULT 'pending',
    tx_hashes           TEXT,                       -- JSON array
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at        DATETIME
);

-- Profit tracking
CREATE TABLE profits (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id            BLOB NOT NULL REFERENCES orders(order_id),
    gross_fee           TEXT NOT NULL,              -- amount_in - amount_out
    settlement_cost     TEXT NOT NULL,
    gas_cost            TEXT NOT NULL,
    net_profit          TEXT NOT NULL,
    recorded_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_profits_date ON profits(recorded_at);
```

### 4.2 Configuration Schema

```yaml
# config.yml

solver:
  name: "dydx-hl-solver"
  version: "1.0.0"

  # Solver addresses (must match keys.json)
  addresses:
    hyperliquid: "0x..."
    noble: "noble1..."
    arbitrum: "0x..."

# Chain configurations
chains:
  noble-1:
    type: "cosmos"
    chain_name: "Noble"
    environment: "mainnet"
    fast_transfer_contract: "noble1..." # FastTransfer gateway
    usdc_denom: "uusdc"
    cosmos:
      rpc: "https://noble-rpc.polkachu.com"
      grpc: "noble-grpc.polkachu.com:443"
      grpc_tls: true
      gas_price: 0.001
      gas_denom: "uusdc"
      address_prefix: "noble"
    hyperlane:
      domain: 1234
      mailbox: "noble1..."

  osmosis-1:
    type: "cosmos"
    chain_name: "Osmosis"
    environment: "mainnet"
    fast_transfer_contract: "osmo1..."
    usdc_denom: "ibc/..."
    cosmos:
      rpc: "https://osmosis-rpc.polkachu.com"
      grpc: "osmosis-grpc.polkachu.com:443"
      grpc_tls: true
      gas_price: 0.0025
      gas_denom: "uosmo"
      address_prefix: "osmo"
    hyperlane:
      domain: 5678
      mailbox: "osmo1..."

  42161:  # Arbitrum
    type: "evm"
    chain_name: "Arbitrum"
    environment: "mainnet"
    fast_transfer_contract: "0x..."
    usdc_address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
    evm:
      rpc: "https://arb1.arbitrum.io/rpc"
      chain_id: 42161
      gas_token: "ETH"
    hyperlane:
      domain: 42161
      mailbox: "0x..."

# Hyperliquid configuration (custom, not in standard Skip config)
hyperliquid:
  api_url: "https://api.hyperliquid.xyz"
  info_url: "https://api.hyperliquid.xyz/info"
  chain_id: "Mainnet"
  signature_chain_id: "0xa4b1"  # 42161 in hex (Arbitrum)
  bridge_address: "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7"
  custom_domain: 99999  # Our defined domain ID for HL

# Fulfillment settings
fulfillment:
  min_profit_bps: 5           # Minimum 0.05% profit to fill
  max_fill_amount: 100000     # Max $100k per fill
  fill_timeout_seconds: 30    # Time to complete fill

# Inventory thresholds (USDC amounts)
inventory:
  hyperliquid:
    target: 100000
    min: 10000                # Trigger rebalance below this
    max: 200000               # Withdraw excess above this
  noble:
    target: 50000
    min: 5000
    max: 100000
  arbitrum:
    target: 20000
    min: 2000
    max: 50000

# Settlement settings
settlement:
  batch_size: 10              # Orders per batch
  batch_interval_seconds: 300 # 5 minutes between batches
  min_batch_amount: 1000      # Minimum $1000 to trigger settlement

# Monitoring & alerts
monitoring:
  balance_check_interval: 60  # seconds
  health_check_port: 8080
  metrics_port: 9090
  alerts:
    slack_webhook: ""
    email: ""
    low_balance_threshold: 5000
```

### 4.3 Keys Configuration

```json
// keys.json (encrypted in production)
{
  "hyperliquid": {
    "address": "0x...",
    "private_key": "0x..."
  },
  "noble": {
    "address": "noble1...",
    "mnemonic": "word1 word2 ... word24"
  },
  "arbitrum": {
    "address": "0x...",
    "private_key": "0x..."
  }
}
```

---

## 5. Hyperliquid Destination Encoding (Optimal Solution)

Since Hyperliquid is not a standard Skip:Go Fast destination chain, we need a way to signal
to our solver that an intent should be fulfilled on Hyperliquid via `usdSend` rather than
a standard on-chain transfer.

### 5.1 Solution: Use Arbitrum Domain + Data Field Magic Prefix

**Why this approach?**
- No custom domain registration required
- Works with existing Skip:Go Fast infrastructure
- Solver-side logic only - no contract modifications
- Clean separation: standard solvers ignore, our solver recognizes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  DESTINATION ENCODING STRATEGY                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Intent Parameters:                                                         │
│  ├── destination_domain: 42161 (Arbitrum - standard, already supported)    │
│  ├── recipient: User's EVM address (0x123...)                               │
│  └── data: "HL:" + encoded_metadata (magic prefix signals Hyperliquid)      │
│                                                                             │
│  Solver Detection Logic:                                                    │
│  1. Monitor all intents with destination_domain == 42161                    │
│  2. Check if data field starts with "HL:" (0x484C3A in hex)                 │
│  3. If YES → Fulfill via Hyperliquid usdSend                                │
│  4. If NO  → Standard Arbitrum fulfillment (or skip if not our intent)     │
│                                                                             │
│  Benefits:                                                                  │
│  ✓ Other solvers see valid Arbitrum intent, may compete (good for users)   │
│  ✓ If we're offline, user still gets funds on Arbitrum (fallback works)    │
│  ✓ No governance/registration needed                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Data Field Encoding

```go
// Magic prefix for Hyperliquid-bound intents
const HLMagicPrefix = "HL:"  // 0x484C3A in hex

// Metadata structure (encoded after the magic prefix)
type HLIntentMetadata struct {
    Version         uint8           // Schema version (1)
    DestType        uint8           // 1 = main account, 2 = sub-account, 3 = vault
    HLAddress       [20]byte        // User's Hyperliquid address (same as recipient usually)
    SubAccount      [20]byte        // Optional: sub-account address (zeros if main)
    Flags           uint8           // Bit flags for options
}

// Flags:
// 0x01 = Transfer to sub-account (use SubAccount field)
// 0x02 = Transfer to perp margin (vs spot balance)
// 0x04 = Reserved for future use

// Full data field format:
// Bytes 0-2:   "HL:" magic prefix (0x484C3A)
// Byte 3:     Version (0x01)
// Byte 4:     DestType (0x01 for main account)
// Bytes 5-24: HLAddress (20 bytes)
// Bytes 25-44: SubAccount (20 bytes, zeros if not used)
// Byte 45:    Flags

// Encoding function
func EncodeHLIntentData(hlAddress common.Address, opts *HLOptions) []byte {
    data := make([]byte, 0, 46)

    // Magic prefix
    data = append(data, []byte("HL:")...)

    // Version
    data = append(data, 0x01)

    // DestType
    destType := uint8(1) // main account
    if opts != nil && opts.SubAccount != nil {
        destType = 2
    }
    data = append(data, destType)

    // HLAddress (20 bytes)
    data = append(data, hlAddress.Bytes()...)

    // SubAccount (20 bytes)
    if opts != nil && opts.SubAccount != nil {
        data = append(data, opts.SubAccount.Bytes()...)
    } else {
        data = append(data, make([]byte, 20)...)
    }

    // Flags
    flags := uint8(0)
    if opts != nil {
        if opts.SubAccount != nil {
            flags |= 0x01
        }
        if opts.ToPerp {
            flags |= 0x02
        }
    }
    data = append(data, flags)

    return data
}

// Decoding function (solver-side)
func DecodeHLIntentData(data []byte) (*HLIntentMetadata, error) {
    // Check magic prefix
    if len(data) < 3 || string(data[:3]) != "HL:" {
        return nil, ErrNotHLIntent
    }

    if len(data) < 46 {
        return nil, ErrInvalidHLData
    }

    meta := &HLIntentMetadata{
        Version:  data[3],
        DestType: data[4],
    }
    copy(meta.HLAddress[:], data[5:25])
    copy(meta.SubAccount[:], data[25:45])
    meta.Flags = data[45]

    return meta, nil
}
```

### 5.3 Solver Detection Flow

```go
func (f *HLFulfiller) ShouldFulfill(order *OrderSubmittedEvent) bool {
    // Only look at Arbitrum-domain intents
    if order.DestinationDomain != 42161 {
        return false
    }

    // Check for HL magic prefix
    hlMeta, err := DecodeHLIntentData(order.Data)
    if err != nil {
        // Not an HL intent, skip (let other solvers handle it)
        return false
    }

    // Validate HL metadata
    if hlMeta.Version != 1 {
        log.Warn("Unknown HL intent version", "version", hlMeta.Version)
        return false
    }

    // Check inventory
    if !f.inventoryMgr.HasSufficientBalance("hyperliquid", order.AmountOut) {
        log.Warn("Insufficient HL inventory for fill")
        return false
    }

    return true
}
```

### 5.4 Fallback Behavior

If our solver is offline or out of inventory, the intent still has a valid Arbitrum destination.
Other Skip:Go Fast solvers can fulfill it to Arbitrum, and the user can manually deposit to
Hyperliquid. This provides graceful degradation.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  FALLBACK SCENARIOS                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Scenario 1: Our solver online, has inventory                               │
│  → User receives USDC on Hyperliquid in ~10 seconds ✓                       │
│                                                                             │
│  Scenario 2: Our solver online, but low inventory                           │
│  → We skip the order                                                        │
│  → Other solver fills to Arbitrum                                           │
│  → User receives USDC on Arbitrum, can deposit to HL manually               │
│                                                                             │
│  Scenario 3: Our solver offline                                             │
│  → Other solver fills to Arbitrum (they ignore HL: prefix)                  │
│  → User receives USDC on Arbitrum                                           │
│  → Frontend can prompt: "Solver unavailable. Deposit to Hyperliquid?"       │
│                                                                             │
│  Scenario 4: No solvers available, intent times out                         │
│  → User's funds returned to source via timeout mechanism                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. API Specifications

### 6.1 Frontend → Solver API

```yaml
openapi: 3.0.0
info:
  title: dYdX-HL Solver API
  version: 1.0.0

paths:
  /v1/quote:
    post:
      summary: Get a quote for dYdX → Hyperliquid transfer
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - source_chain
                - amount
                - hl_address
              properties:
                source_chain:
                  type: string
                  enum: ["dydx-mainnet-1", "noble-1"]
                amount:
                  type: string
                  description: Amount in USDC (6 decimals)
                hl_address:
                  type: string
                  description: User's Hyperliquid address
      responses:
        200:
          content:
            application/json:
              schema:
                type: object
                properties:
                  quote_id:
                    type: string
                  amount_in:
                    type: string
                  amount_out:
                    type: string
                  fee_bps:
                    type: integer
                  fee_amount:
                    type: string
                  estimated_time_seconds:
                    type: integer
                  expires_at:
                    type: string
                    format: date-time

  /v1/status/{order_id}:
    get:
      summary: Get order status
      parameters:
        - name: order_id
          in: path
          required: true
          schema:
            type: string
      responses:
        200:
          content:
            application/json:
              schema:
                type: object
                properties:
                  order_id:
                    type: string
                  status:
                    type: string
                    enum: [pending, filled, settled, expired, failed]
                  fill_tx:
                    type: string
                  filled_at:
                    type: string
                  settlement_status:
                    type: string

  /v1/inventory:
    get:
      summary: Get solver inventory status
      responses:
        200:
          content:
            application/json:
              schema:
                type: object
                properties:
                  hyperliquid:
                    type: object
                    properties:
                      balance:
                        type: string
                      available:
                        type: string
                      status:
                        type: string
                        enum: [healthy, low, critical]
                  max_fill_amount:
                    type: string
```

### 6.2 Hyperliquid API Integration

```typescript
// Hyperliquid usdSend request format
interface UsdSendAction {
  type: "usdSend";
  destination: string;      // Recipient's HL address
  amount: string;           // Amount as decimal string, e.g., "999.0"
  time: number;             // Unix timestamp in milliseconds
}

interface HLExchangeRequest {
  action: UsdSendAction;
  nonce: number;
  signature: {
    r: string;
    s: string;
    v: number;
  };
  vaultAddress?: string;    // If using vault/sub-account
}

// EIP-712 domain for signing
const HL_DOMAIN = {
  name: "Exchange",
  version: "1",
  chainId: 42161,           // Arbitrum chain ID
  verifyingContract: "0x0000000000000000000000000000000000000000"
};

// EIP-712 types
const USD_SEND_TYPES = {
  UsdSend: [
    { name: "destination", type: "string" },
    { name: "amount", type: "string" },
    { name: "time", type: "uint64" }
  ]
};
```

---

## 7. Security Considerations

### 7.1 Key Management

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  KEY SECURITY REQUIREMENTS                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. ENCRYPTION AT REST                                                      │
│     ├── Keys file encrypted with AES-256-GCM                                │
│     ├── Encryption key from environment variable (AES_KEY_HEX)              │
│     └── Never store plaintext keys in config files                          │
│                                                                             │
│  2. ENVIRONMENT ISOLATION                                                   │
│     ├── Testnet keys separate from mainnet                                  │
│     ├── Different addresses for different environments                      │
│     └── Environment variable: SOLVER_ENV=mainnet|testnet                    │
│                                                                             │
│  3. ACCESS CONTROL                                                          │
│     ├── Keys file readable only by solver process user                      │
│     ├── No keys in logs, metrics, or error messages                         │
│     └── Audit logging for all signing operations                            │
│                                                                             │
│  4. ROTATION STRATEGY                                                       │
│     ├── Ability to rotate keys without downtime                             │
│     ├── Grace period for old keys during rotation                           │
│     └── Automated alerts for approaching rotation dates                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Inventory Risk Management

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  INVENTORY RISKS & MITIGATIONS                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  RISK: Hyperliquid platform risk (exchange failure, hack)                   │
│  MITIGATION:                                                                │
│  ├── Keep HL inventory at minimum required for operations                   │
│  ├── Set max_balance threshold to auto-withdraw excess                      │
│  └── Monitor HL system status, pause fills on anomalies                     │
│                                                                             │
│  RISK: Settlement delays leave solver under-capitalized                     │
│  MITIGATION:                                                                │
│  ├── Maintain buffer capital across all platforms                           │
│  ├── Reduce fill rate when pending settlements exceed threshold             │
│  └── Hyperlane relay monitoring with timeout alerts                         │
│                                                                             │
│  RISK: Price volatility during settlement                                   │
│  MITIGATION:                                                                │
│  ├── USDC only - no volatile asset exposure                                 │
│  └── Settlement typically < 30 min, minimal depegging risk                  │
│                                                                             │
│  RISK: Smart contract bugs in FastTransfer contracts                        │
│  MITIGATION:                                                                │
│  ├── Use only audited Skip:Go Fast contracts                                │
│  ├── Start with low max_fill_amount, increase gradually                     │
│  └── Monitor contract upgrade events                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Rate Limiting & DoS Protection

```go
// Rate limiting configuration
type RateLimits struct {
    // Per-user limits
    MaxOrdersPerUser      int           // 10 orders per minute
    MaxVolumePerUser      *big.Int      // $50,000 per hour

    // Global limits
    MaxOrdersPerMinute    int           // 100 orders per minute
    MaxVolumePerHour      *big.Int      // $1,000,000 per hour

    // Fill limits
    MaxFillsPerMinute     int           // 50 fills per minute
    MinTimeBetweenFills   time.Duration // 500ms minimum
}

// Implement with sliding window counters
// Reject orders exceeding limits with clear error messages
```

---

## 8. Operational Requirements

### 8.1 Infrastructure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  INFRASTRUCTURE REQUIREMENTS                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  COMPUTE                                                                    │
│  ├── 2+ vCPU, 4GB+ RAM minimum                                              │
│  ├── SSD storage for database (10GB minimum)                                │
│  └── Recommend: 4 vCPU, 8GB RAM for production                              │
│                                                                             │
│  NETWORK                                                                    │
│  ├── Low latency to RPC endpoints (< 100ms)                                 │
│  ├── Stable connection (websocket subscriptions)                            │
│  └── Redundant RPC endpoints for failover                                   │
│                                                                             │
│  REDUNDANCY                                                                 │
│  ├── Primary + standby solver instances                                     │
│  ├── Database replication                                                   │
│  └── Health check endpoint for load balancer                                │
│                                                                             │
│  MONITORING                                                                 │
│  ├── Prometheus metrics endpoint (:9090)                                    │
│  ├── Grafana dashboards for key metrics                                     │
│  ├── PagerDuty/Slack alerts for critical events                             │
│  └── Log aggregation (ELK/Loki)                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Capital Requirements

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CAPITAL REQUIREMENTS                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  MINIMUM VIABLE (Low Volume)                                                │
│  ├── Hyperliquid:  $20,000 USDC                                             │
│  ├── Noble:        $10,000 USDC                                             │
│  ├── Arbitrum:     $5,000 USDC + 0.1 ETH (gas)                              │
│  └── Total:        ~$35,000                                                 │
│                                                                             │
│  RECOMMENDED (Medium Volume)                                                │
│  ├── Hyperliquid:  $100,000 USDC                                            │
│  ├── Noble:        $50,000 USDC                                             │
│  ├── Arbitrum:     $20,000 USDC + 0.5 ETH                                   │
│  └── Total:        ~$170,000                                                │
│                                                                             │
│  HIGH VOLUME                                                                │
│  ├── Hyperliquid:  $500,000 USDC                                            │
│  ├── Noble:        $200,000 USDC                                            │
│  ├── Arbitrum:     $100,000 USDC + 2 ETH                                    │
│  └── Total:        ~$800,000                                                │
│                                                                             │
│  EXPECTED RETURNS (at 10 bps fee)                                           │
│  ├── $1M daily volume = $1,000/day gross                                    │
│  ├── Settlement costs: ~$50/day                                             │
│  ├── Infrastructure: ~$100/day                                              │
│  └── Net: ~$850/day (~$25k/month)                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Development TODO List

### Phase 1: Foundation (Week 1-2)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: FOUNDATION                                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  □ 1.1 Project Setup                                                        │
│     □ Fork skip-go-fast-solver repository                                   │
│     □ Set up Go development environment (Go 1.21+)                          │
│     □ Configure linting (golangci-lint) and testing                         │
│     □ Set up CI/CD pipeline (GitHub Actions)                                │
│     □ Create development/staging/production config templates                │
│                                                                             │
│  □ 1.2 Hyperliquid Client Library                                           │
│     □ Create `pkg/hyperliquid/` package                                     │
│     □ Implement EIP-712 signing for HL actions                              │
│     □ Implement usdSend function                                            │
│     □ Implement balance query (info endpoint)                               │
│     □ Implement nonce management                                            │
│     □ Add retry logic with exponential backoff                              │
│     □ Write unit tests with mocked responses                                │
│     □ Write integration tests against HL testnet                            │
│                                                                             │
│  □ 1.3 Database Schema                                                      │
│     □ Create SQLite schema (see section 4.1)                                │
│     □ Set up sqlc for type-safe queries                                     │
│     □ Write migration scripts                                               │
│     □ Implement repository layer                                            │
│     □ Write database tests                                                  │
│                                                                             │
│  □ 1.4 Configuration System                                                 │
│     □ Extend config.go for Hyperliquid settings                             │
│     □ Add custom domain (99999) handling                                    │
│     □ Implement config validation for HL fields                             │
│     □ Create sample config files                                            │
│     □ Document configuration options                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 2: Core Solver Logic (Week 3-4)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: CORE SOLVER LOGIC                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  □ 2.1 Intent Monitor Modifications                                         │
│     □ Add Noble chain subscription (if not present)                         │
│     □ Filter for destination_domain == 99999 (Hyperliquid)                  │
│     □ Parse HLIntentMetadata from order.data field                          │
│     □ Validate HL address format                                            │
│     □ Route HL-bound orders to HyperliquidFulfiller                         │
│     □ Write tests for HL order detection                                    │
│                                                                             │
│  □ 2.2 Hyperliquid Fulfiller Module                                         │
│     □ Create `hlfulfiller/` package                                         │
│     □ Implement FillRequest queue                                           │
│     □ Implement profitability calculator                                    │
│     │   □ Fee calculation: amount_in - amount_out                           │
│     │   □ Estimate settlement costs                                         │
│     │   □ Apply min_profit_bps threshold                                    │
│     □ Implement fill execution via usdSend                                  │
│     □ Implement fill confirmation (poll HL balance)                         │
│     □ Record fills in database                                              │
│     □ Queue filled orders for settlement                                    │
│     □ Handle fill failures gracefully                                       │
│     □ Write comprehensive tests                                             │
│                                                                             │
│  □ 2.3 Inventory Manager                                                    │
│     □ Create `inventory/` package                                           │
│     □ Implement multi-platform balance polling                              │
│     │   □ Hyperliquid balance via info API                                  │
│     │   □ Noble balance via gRPC                                            │
│     │   □ Arbitrum balance via ethclient                                    │
│     □ Implement threshold monitoring                                        │
│     □ Implement rebalance decision logic                                    │
│     □ Implement rebalance execution                                         │
│     │   □ Noble → Arbitrum (CCTP)                                           │
│     │   □ Arbitrum → Hyperliquid (bridge deposit)                           │
│     │   □ Hyperliquid → Arbitrum (withdrawal)                               │
│     │   □ Arbitrum → Noble (CCTP)                                           │
│     □ Add rebalance to database logging                                     │
│     □ Write tests for rebalance scenarios                                   │
│                                                                             │
│  □ 2.4 Settlement Processor                                                 │
│     □ Extend existing ordersettler for HL fills                             │
│     □ Implement batching logic                                              │
│     □ Implement settlement initiation                                       │
│     □ Monitor Hyperlane relay progress                                      │
│     □ Verify fund receipt                                                   │
│     □ Update database on completion                                         │
│     □ Trigger rebalancing after large settlements                           │
│     □ Write settlement flow tests                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 3: Frontend & Integration (Week 5-6)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: FRONTEND & INTEGRATION                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  □ 3.1 Solver API Server                                                    │
│     □ Create HTTP API server (gin or chi)                                   │
│     □ Implement /v1/quote endpoint                                          │
│     □ Implement /v1/status/{order_id} endpoint                              │
│     □ Implement /v1/inventory endpoint                                      │
│     □ Add rate limiting middleware                                          │
│     □ Add request logging                                                   │
│     □ Add health check endpoint                                             │
│     □ Write API tests                                                       │
│     □ Generate OpenAPI documentation                                        │
│                                                                             │
│  □ 3.2 Frontend Modifications                                               │
│     □ Update App.jsx for new solver flow                                    │
│     │   □ Remove two-step bridge orchestration                              │
│     │   □ Add solver quote fetching                                         │
│     │   □ Display solver fee clearly                                        │
│     │   □ Show estimated time (~15 seconds)                                 │
│     □ Update dYdX → Noble IBC transfer logic                                │
│     │   □ Generate Noble address from same key                              │
│     │   □ Build IBC MsgTransfer                                             │
│     │   □ Sign with Keplr                                                   │
│     □ Implement FastTransfer intent submission                              │
│     │   □ Encode HLIntentMetadata                                           │
│     │   □ Build submitOrder message                                         │
│     │   □ Sign with Keplr (Noble chain)                                     │
│     □ Implement status polling                                              │
│     │   □ Poll solver /v1/status endpoint                                   │
│     │   □ Show fill confirmation                                            │
│     │   □ Link to Hyperliquid account                                       │
│     □ Update UI components                                                  │
│     │   □ Simplified progress indicator (2 steps vs 4)                      │
│     │   □ Fee breakdown display                                             │
│     │   □ "Filled by solver" confirmation                                   │
│     □ Error handling for solver unavailable                                 │
│     □ Fallback to manual flow if solver offline                             │
│                                                                             │
│  □ 3.3 Noble Integration                                                    │
│     □ Verify FastTransfer contract on Noble                                 │
│     │   □ Check if deployed (query Skip team if needed)                     │
│     │   □ If not deployed, investigate Osmosis alternative                  │
│     □ Add Noble chain config to frontend                                    │
│     □ Test IBC dYdX → Noble path                                            │
│     □ Test submitOrder on Noble testnet                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 4: Testing & Deployment (Week 7-8)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: TESTING & DEPLOYMENT                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  □ 4.1 Testnet Deployment                                                   │
│     □ Deploy solver to testnet environment                                  │
│     │   □ Set up testnet config (Noble testnet, HL testnet)                 │
│     │   □ Fund testnet wallets                                              │
│     │   □ Configure low thresholds for testing                              │
│     □ End-to-end testing                                                    │
│     │   □ Test dYdX → HL flow                                               │
│     │   □ Test HL → dYdX flow (if implemented)                              │
│     │   □ Test settlement completion                                        │
│     │   □ Test rebalancing triggers                                         │
│     │   □ Test error scenarios                                              │
│     □ Load testing                                                          │
│     │   □ Simulate concurrent order submissions                             │
│     │   □ Measure fill latency                                              │
│     │   □ Test rate limiting                                                │
│     □ Document testnet results                                              │
│                                                                             │
│  □ 4.2 Monitoring & Alerting                                                │
│     □ Set up Prometheus metrics                                             │
│     │   □ Orders received/filled/settled counts                             │
│     │   □ Fill latency histogram                                            │
│     │   □ Inventory levels gauge                                            │
│     │   □ Profit accumulation                                               │
│     │   □ Error rates                                                       │
│     □ Create Grafana dashboards                                             │
│     │   □ Solver overview dashboard                                         │
│     │   □ Inventory health dashboard                                        │
│     │   □ Profit/loss dashboard                                             │
│     □ Configure alerts                                                      │
│     │   □ Low inventory (< min threshold)                                   │
│     │   □ High fill latency (> 10 seconds)                                  │
│     │   □ Settlement failures                                               │
│     │   □ Solver process down                                               │
│     □ Set up log aggregation                                                │
│                                                                             │
│  □ 4.3 Mainnet Deployment                                                   │
│     □ Security review                                                       │
│     │   □ Key management audit                                              │
│     │   □ Access control review                                             │
│     │   □ Dependency vulnerability scan                                     │
│     □ Create mainnet config                                                 │
│     □ Fund mainnet wallets (start with minimum capital)                     │
│     □ Deploy solver with conservative settings                              │
│     │   □ Low max_fill_amount initially                                     │
│     │   □ High min_profit_bps initially                                     │
│     □ Gradual rollout                                                       │
│     │   □ Day 1-3: $1,000 max fill                                          │
│     │   □ Day 4-7: $10,000 max fill                                         │
│     │   □ Week 2+: Full capacity                                            │
│     □ Monitor closely during initial period                                 │
│                                                                             │
│  □ 4.4 Documentation                                                        │
│     □ Update README.md with new architecture                                │
│     □ Write operator guide (deployment, config, troubleshooting)            │
│     □ Write user guide (how to use the bridge)                              │
│     □ Document API endpoints                                                │
│     □ Create architecture diagrams                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 5: Enhancements (Post-Launch)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 5: ENHANCEMENTS (POST-LAUNCH)                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  □ 5.1 Reverse Flow (HL → dYdX)                                             │
│     □ Design reverse flow architecture                                      │
│     □ Implement Arbitrum intent monitoring                                  │
│     □ Implement Noble/dYdX fulfillment                                      │
│     □ Update frontend for bidirectional transfers                           │
│                                                                             │
│  □ 5.2 Multi-Solver Competition                                             │
│     □ Implement competitive pricing                                         │
│     □ Add latency optimizations                                             │
│     □ Consider MEV protection strategies                                    │
│                                                                             │
│  □ 5.3 Additional Features                                                  │
│     □ Sub-account support for Hyperliquid                                   │
│     □ Spot vs perp margin routing                                           │
│     □ Limit order integration                                               │
│     □ Recurring/scheduled transfers                                         │
│                                                                             │
│  □ 5.4 Optimizations                                                        │
│     □ Reduce fill latency                                                   │
│     □ Optimize settlement batching                                          │
│     □ Improve rebalancing efficiency                                        │
│     □ Add predictive inventory management                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| FastTransfer not deployed on Noble | Medium | High | Fall back to Osmosis route; contact Skip team |
| Hyperliquid API changes | Low | Medium | Version lock, monitor announcements |
| Settlement delays > 1 hour | Low | Medium | Buffer capital, rate limit fills |
| Solver private key compromise | Low | Critical | HSM/secure enclave, minimal hot wallet balance |
| Smart contract vulnerability | Low | Critical | Use audited contracts, start with low limits |
| Hyperliquid platform incident | Low | High | Auto-pause on anomalies, keep min inventory |
| High gas during rebalancing | Medium | Low | Batch operations, gas price limits |
| Competition from other solvers | Medium | Medium | Optimize latency, competitive fees |

---

## 11. Open Questions

### Resolved

1. ~~**Intent Origination**~~: ✅ Intents originate on dYdX. User signs ONE transaction via Skip API,
   which handles IBC routing to Cosmos Hub (with FastTransfer contract) automatically.

2. ~~**Custom Domain Registration**~~: ✅ Use existing Arbitrum domain (42161) + "HL:" magic prefix
   in data field. Solver-side detection only. No contract modifications needed.
   See Section 5 for full encoding spec.

3. ~~**Hyperliquid Rate Limits**~~: ✅ Not a concern for initial testing (single user).

### Remaining Questions

1. **Cosmos Hub FastTransfer Deployment**: Verify Skip:Go Fast contracts are deployed on Cosmos Hub
   with permissionless CosmWasm. If not deployed yet, check timeline with Skip team.

2. **Skip API Go Fast + Cosmos Hub**: Confirm Skip API's `go_fast: true` routes through Cosmos Hub
   FastTransfer contract. May need to test with actual API call.

3. **Sub-account Support**: Does Hyperliquid's usdSend support sending directly to sub-accounts,
   or only main accounts? (Lower priority - main account support is sufficient for MVP)

4. **IBC Memo Format**: Verify exact format for IBC memo to trigger CosmWasm execution on Cosmos Hub.
   May use Packet Forward Middleware (PFM) or native wasm memo format.

5. **Testnet Availability**: Identify testnets for end-to-end testing:
   - Cosmos Hub testnet with FastTransfer?
   - Hyperliquid testnet for usdSend testing?

---

## 12. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Fill Latency | < 5 seconds | P95 time from intent submission to HL credit |
| Fill Rate | > 99% | Orders filled / orders received |
| Settlement Success | > 99.9% | Settlements completed / settlements initiated |
| Uptime | > 99.9% | Solver available / total time |
| User Satisfaction | < 30 seconds total | Time from dYdX withdrawal to HL trading |
| Profitability | > 50% margin | Net profit / gross fees after costs |

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| Intent | User's declared desire to transfer assets, submitted to FastTransfer contract |
| Solver | Operator that fulfills intents by fronting capital |
| Fill | Execution of an intent by a solver |
| Settlement | Process by which solver recovers fronted capital + fees |
| Rebalancing | Moving inventory between chains/platforms to maintain target levels |
| FastTransfer | Skip:Go Fast smart contract for intent submission |
| usdSend | Hyperliquid API for internal USDC transfers |
| CCTP | Circle's Cross-Chain Transfer Protocol for native USDC bridging |
| Hyperlane | Cross-chain messaging protocol used for settlement verification |

---

## Appendix B: Reference Links

- [Skip:Go Fast Solver Repository](https://github.com/skip-mev/skip-go-fast-solver)
- [Skip:Go Fast Contracts](https://github.com/skip-mev/go-fast-contracts)
- [Hyperliquid API Documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api)
- [Noble Chain Documentation](https://docs.nobleassets.xyz/)
- [dYdX Chain Documentation](https://docs.dydx.xyz/)
- [Hyperlane Documentation](https://docs.hyperlane.xyz/)
