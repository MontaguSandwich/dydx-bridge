# PERP BRIDGE 

**Unified dYdX ↔ Hyperliquid USDC Bridge**

A frontend that bundles the complete bridging flow between dYdX (Cosmos) and Hyperliquid (HyperCore) perps platforms. Since no single aggregator supports this full route, this app orchestrates a two-step process using Skip Go and LI.FI.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          PERP BRIDGE FRONTEND                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │   Keplr Wallet  │    │  MetaMask/EVM   │    │   Status Poller │     │
│  │   (dYdX Chain)  │    │   (Arbitrum)    │    │   (Both APIs)   │     │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘     │
│           │                      │                      │               │
│  ┌────────┴──────────────────────┴──────────────────────┴────────┐     │
│  │                     Bridge Orchestrator                        │     │
│  │  ┌─────────────────────────────────────────────────────────┐  │     │
│  │  │  1. Quote Both Legs       2. Execute Sequentially       │  │     │
│  │  │  3. Poll Status           4. Report Completion          │  │     │
│  │  └─────────────────────────────────────────────────────────┘  │     │
│  └───────────────────────────────────────────────────────────────┘     │
│           │                                      │                      │
└───────────┼──────────────────────────────────────┼──────────────────────┘
            │                                      │
            ▼                                      ▼
┌───────────────────────┐              ┌───────────────────────┐
│      SKIP GO API      │              │      LI.FI API        │
│  api.skip.build/v2    │              │     li.quest/v1       │
│                       │              │                       │
│  • /fungible/route    │              │  • /quote             │
│  • /fungible/msgs     │              │  • /status            │
│  • /tx/status         │              │                       │
└───────────┬───────────┘              └───────────┬───────────┘
            │                                      │
            ▼                                      ▼
┌───────────────────────┐              ┌───────────────────────┐
│       dYdX Chain      │              │   Hyperliquid Bridge  │
│     (Cosmos/IBC)      │              │  0x2Df1c51E...163dF7  │
│                       │              │                       │
│  USDC via Noble/CCTP  │  ────────►   │  USDC on Arbitrum     │
│                       │  Arbitrum    │  → HyperCore Credit   │
└───────────────────────┘              └───────────────────────┘
```

## 🔗 Bridge Flow

### dYdX → Hyperliquid (Primary Use Case)

| Step | Action | Protocol | Time |
|------|--------|----------|------|
| 1 | Withdraw from dYdX subaccount | dYdX Chain | ~1 block |
| 2 | Bridge dYdX → Arbitrum via CCTP | Skip Go | ~3-5 min |
| 3 | Deposit Arbitrum USDC → Hyperliquid | LI.FI / Native | ~1-2 min |
| 4 | Funds available in HyperCore | Hyperliquid | Instant |

**Total Time:** ~5-8 minutes

### Token Addresses

| Chain | Token | Address/Denom |
|-------|-------|---------------|
| dYdX | USDC | `ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5` |
| Arbitrum | USDC (Native) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| Hyperliquid | Bridge | `0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7` |

## 🚀 Quick Start

```bash
# Clone and install
git clone <repo>
cd perp-bridge
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

Open http://localhost:3000

## 📁 Project Structure

```
perp-bridge/
├── src/
│   ├── App.jsx              # Main React component
│   ├── main.jsx             # Entry point
│   └── services/
│       ├── skipGo.js        # Skip Go API integration
│       ├── lifi.js          # LI.FI API integration
│       └── hyperliquid.js   # Direct Hyperliquid bridge
├── package.json
├── vite.config.js
└── index.html
```

## 🔧 API Integration Details

### Skip Go (dYdX → Arbitrum)

```javascript
// Get route
POST https://api.skip.build/v2/fungible/route
{
  "source_asset_denom": "ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5",
  "source_asset_chain_id": "dydx-mainnet-1",
  "dest_asset_denom": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "dest_asset_chain_id": "42161",
  "amount_in": "10000000",
  "bridges": ["CCTP", "IBC"],
  "smart_relay": true
}

// Execute
POST https://api.skip.build/v2/fungible/msgs
// Returns Cosmos SDK messages to sign with Keplr
```

### LI.FI (Arbitrum → Hyperliquid)

```javascript
// Get quote
GET https://li.quest/v1/quote?
  fromChain=42161&
  toChain=hyperliquid&
  fromToken=0xaf88d065e77c8cC2239327C5EDb3A432268e5831&
  toToken=0xaf88d065e77c8cC2239327C5EDb3A432268e5831&
  fromAmount=10000000&
  fromAddress=0x...

// Returns transaction data to sign with MetaMask
```

### Direct Hyperliquid Bridge (Alternative)

```javascript
// Simple USDC transfer to bridge contract
const bridgeAddress = "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7";
await usdcContract.transfer(bridgeAddress, amount);
// Credited to sender's HyperCore account in <1 min
```

## ⚙️ Configuration

### Environment Variables (optional)

```env
VITE_SKIP_API_KEY=your_skip_api_key
VITE_LIFI_API_KEY=your_lifi_api_key
VITE_ARBITRUM_RPC=https://arb1.arbitrum.io/rpc
```

### Wallet Requirements

| Wallet | Chain | Purpose |
|--------|-------|---------|
| Keplr | dYdX Chain | Sign Cosmos transactions |
| MetaMask | Arbitrum | Sign EVM transactions |

**Note:** The same EVM address is used for both Arbitrum and Hyperliquid.

## 🔒 Security Considerations

1. **No Custody**: All transactions are signed locally in user wallets
2. **Verified Contracts**: Only interacts with official bridge contracts
3. **Rate Limiting**: Skip and LI.FI have built-in rate limits
4. **Slippage Protection**: Configurable slippage tolerance (default 1%)

## 💡 Usage Tips

- **Minimum Amount**: 5 USDC (Hyperliquid bridge minimum)
- **Gas Requirements**: 
  - Small amount of DYDX for dYdX gas
  - Small amount of ETH on Arbitrum for gas
- **Fastest Route**: Skip Go Fast + LI.FI Intent-based

## 🛣️ Roadmap

- [ ] Hyperliquid → dYdX reverse flow
- [ ] Multiple EVM wallet support (WalletConnect, Coinbase)
- [ ] Transaction history persistence
- [ ] Mobile responsive improvements
- [ ] Gas estimation display
- [ ] Multi-leg batching optimization

## 📚 Resources

- [dYdX Docs - Onboarding](https://docs.dydx.xyz/interaction/integration/integration-onboarding)
- [Skip Go Docs](https://docs.skip.build)
- [LI.FI Docs](https://docs.li.fi)
- [Hyperliquid Bridge Docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/bridge2)

## ✅ Production Status

**This bridge is now production-ready with real transaction signing:**

- ✅ `@cosmjs/stargate` for Cosmos/dYdX signing
- ✅ `ethers.js v6` for EVM/Arbitrum signing  
- ✅ Automatic balance polling for CCTP arrival
- ✅ ERC-20 approval handling for LI.FI swaps
- ✅ User rejection error handling
- ✅ Explorer links for transaction tracking

### Deployment

```bash
# Production build
npm run build

# Deploy dist/ to any static host:
# - Vercel: vercel deploy dist
# - Netlify: netlify deploy --prod --dir=dist
# - Cloudflare Pages: wrangler pages deploy dist
```

### Docker

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
```

## ⚠️ Disclaimer

This is experimental software. Bridge operations involve real funds and cross-chain transactions. Always verify transaction details before signing. Use at your own risk.

## 📄 License

MIT
