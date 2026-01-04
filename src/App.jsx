import React, { useState, useEffect, useCallback, Component } from 'react';
import { TransactionHistory } from './components/TransactionHistory.jsx';
import {
  addTransaction,
  updateTransaction,
  getPendingTransactions,
  TxStatusEnum
} from './services/history.js';

// Error Boundary to prevent white screen crashes
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Bridge Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0f',
          color: '#fff',
          fontFamily: 'system-ui, sans-serif',
          padding: '2rem'
        }}>
          <div style={{ textAlign: 'center', maxWidth: '500px' }}>
            <h1 style={{ color: '#ef4444', marginBottom: '1rem' }}>⚠️ Something went wrong</h1>
            <p style={{ color: '#9ca3af', marginBottom: '1.5rem' }}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '0.75rem 1.5rem',
                background: '#6966FF',
                border: 'none',
                borderRadius: '8px',
                color: 'white',
                cursor: 'pointer',
                fontSize: '1rem'
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Chain configurations
const CHAINS = {
  dydx: {
    id: 'dydx-mainnet-1',
    name: 'dYdX',
    logo: '⬡',
    color: '#6966FF',
    usdcDenom: 'ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5'
  },
  arbitrum: {
    id: 42161,
    name: 'Arbitrum',
    logo: '◈',
    color: '#28A0F0',
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
  },
  hyperliquid: {
    id: 'hypercore',
    name: 'Hyperliquid',
    logo: '◎',
    color: '#84CC16',
    bridgeAddress: '0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7'
  }
};

const STEPS = {
  IDLE: 'idle',
  CONNECTING_WALLETS: 'connecting_wallets',
  FETCHING_QUOTES: 'fetching_quotes',
  AWAITING_APPROVAL: 'awaiting_approval',
  BRIDGING_DYDX_ARB: 'bridging_dydx_arb',
  WAITING_ARB_FUNDS: 'waiting_arb_funds',
  BRIDGING_ARB_HL: 'bridging_arb_hl',
  COMPLETE: 'complete',
  ERROR: 'error'
};

const STEP_LABELS = {
  [STEPS.IDLE]: 'Ready',
  [STEPS.CONNECTING_WALLETS]: 'Connecting Wallets...',
  [STEPS.FETCHING_QUOTES]: 'Fetching Routes...',
  [STEPS.AWAITING_APPROVAL]: 'Awaiting Approval...',
  [STEPS.BRIDGING_DYDX_ARB]: 'Bridging dYdX → Arbitrum...',
  [STEPS.WAITING_ARB_FUNDS]: 'Waiting for Arbitrum Funds...',
  [STEPS.BRIDGING_ARB_HL]: 'Bridging Arbitrum → Hyperliquid...',
  [STEPS.COMPLETE]: 'Bridge Complete!',
  [STEPS.ERROR]: 'Error'
};

// Simulated API calls (replace with real implementations)
const skipGoApi = {
  async getRoute(amount, fromAddress, toAddress) {
    // Skip Go API route request
    const response = await fetch('https://api.skip.build/v2/fungible/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_asset_denom: CHAINS.dydx.usdcDenom,
        source_asset_chain_id: CHAINS.dydx.id,
        dest_asset_denom: CHAINS.arbitrum.usdcAddress,
        dest_asset_chain_id: String(CHAINS.arbitrum.id),
        amount_in: String(Math.floor(amount * 1e6)),
        cumulative_affiliate_fee_bps: '0',
        allow_unsafe: true,
        smart_relay: true,
        bridges: ['CCTP', 'IBC', 'AXELAR']
      })
    });
    return response.json();
  },
  
  async getMsgs(route, keplrAddress, evmAddress) {
    // Build address list based on required_chain_addresses from route
    // Skip tells us which chains need addresses
    let addressList;
    
    if (route.required_chain_addresses) {
      // Use the chain order from Skip's response
      addressList = route.required_chain_addresses.map(chainId => {
        // EVM chains
        if (chainId === '42161' || chainId === 42161) return evmAddress;
        // Cosmos chains (dYdX, Noble) - use Keplr address
        return keplrAddress;
      });
    } else {
      // Fallback: assume dYdX -> Arbitrum direct
      addressList = [keplrAddress, evmAddress];
    }
    
    const requestBody = {
      source_asset_denom: route.source_asset_denom,
      source_asset_chain_id: route.source_asset_chain_id,
      dest_asset_denom: route.dest_asset_denom,
      dest_asset_chain_id: route.dest_asset_chain_id,
      amount_in: route.amount_in,
      amount_out: route.amount_out,
      address_list: addressList,
      operations: route.operations,
      slippage_tolerance_percent: "1"
    };
    
    console.log('getMsgs request:', JSON.stringify(requestBody, null, 2));
    
    const response = await fetch('https://api.skip.build/v2/fungible/msgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    return response.json();
  }
};

// Hyperliquid direct bridge - just transfer USDC to bridge contract
const hyperliquidBridge = {
  // No API call needed - it's a direct transfer
  getQuote(amount) {
    // Hyperliquid bridge has no fee, just gas
    return {
      tool: 'Hyperliquid Bridge',
      estimatedTime: '~1 min',
      fee: 0.05, // Estimated gas in USD
      outputAmount: amount, // 1:1, no slippage
      bridgeAddress: CHAINS.hyperliquid.bridgeAddress
    };
  }
};

// Wallet connection hooks
function useWallets() {
  const [keplrAddress, setKeplrAddress] = useState(null);
  const [evmAddress, setEvmAddress] = useState(null);
  const [keplrConnecting, setKeplrConnecting] = useState(false);
  const [evmConnecting, setEvmConnecting] = useState(false);

  const connectKeplr = useCallback(async () => {
    if (!window.keplr) {
      window.open('https://www.keplr.app/', '_blank');
      return;
    }
    setKeplrConnecting(true);
    try {
      await window.keplr.enable('dydx-mainnet-1');
      const offlineSigner = window.keplr.getOfflineSigner('dydx-mainnet-1');
      const accounts = await offlineSigner.getAccounts();
      setKeplrAddress(accounts[0].address);
    } catch (err) {
      console.error('Keplr connection failed:', err);
    }
    setKeplrConnecting(false);
  }, []);

  const connectEvm = useCallback(async () => {
    if (!window.ethereum) {
      window.open('https://metamask.io/', '_blank');
      return;
    }
    setEvmConnecting(true);
    try {
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      });
      setEvmAddress(accounts[0]);
      // Switch to Arbitrum
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xa4b1' }]
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0xa4b1',
              chainName: 'Arbitrum One',
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://arb1.arbitrum.io/rpc'],
              blockExplorerUrls: ['https://arbiscan.io/']
            }]
          });
        }
      }
    } catch (err) {
      console.error('EVM connection failed:', err);
    }
    setEvmConnecting(false);
  }, []);

  const disconnectKeplr = () => setKeplrAddress(null);
  const disconnectEvm = () => setEvmAddress(null);

  return {
    keplrAddress,
    evmAddress,
    keplrConnecting,
    evmConnecting,
    connectKeplr,
    connectEvm,
    disconnectKeplr,
    disconnectEvm,
    isConnected: Boolean(keplrAddress && evmAddress)
  };
}

// Quote display component
function QuoteCard({ title, route, isLoading, error }) {
  if (isLoading) {
    return (
      <div className="quote-card loading">
        <div className="quote-header">{title}</div>
        <div className="quote-loading">
          <div className="spinner" />
          <span>Fetching best route...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="quote-card error">
        <div className="quote-header">{title}</div>
        <div className="quote-error">{error}</div>
      </div>
    );
  }

  if (!route) return null;

  // Safely convert to numbers
  const fee = typeof route.fee === 'number' ? route.fee : parseFloat(route.fee) || 0;
  const outputAmount = typeof route.outputAmount === 'number' ? route.outputAmount : parseFloat(route.outputAmount) || 0;

  return (
    <div className="quote-card">
      <div className="quote-header">{title}</div>
      <div className="quote-details">
        <div className="quote-row">
          <span className="label">Route</span>
          <span className="value">{route.tool || route.bridge || 'Optimal'}</span>
        </div>
        <div className="quote-row">
          <span className="label">Est. Time</span>
          <span className="value">{route.estimatedTime || '~2-5 min'}</span>
        </div>
        <div className="quote-row">
          <span className="label">Est. Fee</span>
          <span className="value">${fee.toFixed(2)}</span>
        </div>
        <div className="quote-row">
          <span className="label">Output</span>
          <span className="value highlight">{outputAmount.toFixed(2)} USDC</span>
        </div>
      </div>
    </div>
  );
}

// Step indicator component
function StepIndicator({ currentStep, steps }) {
  return (
    <div className="step-indicator">
      {steps.map((step, idx) => {
        const isActive = step.id === currentStep;
        const isComplete = steps.findIndex(s => s.id === currentStep) > idx;
        
        return (
          <div key={step.id} className={`step ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}`}>
            <div className="step-number">
              {isComplete ? '✓' : idx + 1}
            </div>
            <div className="step-label">{step.label}</div>
            {idx < steps.length - 1 && <div className="step-connector" />}
          </div>
        );
      })}
    </div>
  );
}

// Transaction status component
function TxStatus({ step, txHashes }) {
  if (step === STEPS.IDLE) return null;

  return (
    <div className="tx-status">
      <div className="status-header">
        <div className={`status-indicator ${step === STEPS.ERROR ? 'error' : step === STEPS.COMPLETE ? 'complete' : 'active'}`} />
        <span>{STEP_LABELS[step]}</span>
      </div>
      
      {txHashes.skipTx && (
        <a 
          href={`https://www.mintscan.io/dydx/tx/${txHashes.skipTx}`}
          target="_blank"
          rel="noopener noreferrer"
          className="tx-link"
        >
          dYdX → Arbitrum TX ↗
        </a>
      )}
      
      {txHashes.lifiTx && (
        <a 
          href={`https://arbiscan.io/tx/${txHashes.lifiTx}`}
          target="_blank"
          rel="noopener noreferrer"
          className="tx-link"
        >
          Arbitrum → Hyperliquid TX ↗
        </a>
      )}
    </div>
  );
}

// Main App Component
function AppContent() {
  const wallets = useWallets();
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState('dydx-to-hl'); // or 'hl-to-dydx'
  const [step, setStep] = useState(STEPS.IDLE);
  const [skipRoute, setSkipRoute] = useState(null);
  const [lifiRoute, setLifiRoute] = useState(null);
  const [skipLoading, setSkipLoading] = useState(false);
  const [lifiLoading, setLifiLoading] = useState(false);
  const [error, setError] = useState(null);
  const [txHashes, setTxHashes] = useState({});
  const [arbUsdcBalance, setArbUsdcBalance] = useState(null);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [currentTxId, setCurrentTxId] = useState(null);

  // Check for pending transactions on mount
  useEffect(() => {
    const pending = getPendingTransactions();
    setPendingCount(pending.length);
  }, []);

  // Check Arbitrum USDC balance
  const checkArbBalance = useCallback(async () => {
    if (!wallets.evmAddress) return;
    
    setCheckingBalance(true);
    try {
      const provider = new window.ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');
      const usdcContract = new window.ethers.Contract(
        CHAINS.arbitrum.usdcAddress,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      );
      const balance = await usdcContract.balanceOf(wallets.evmAddress);
      const balanceNum = Number(balance) / 1e6;
      setArbUsdcBalance(balanceNum);
      console.log('Arbitrum USDC balance:', balanceNum);
      return balanceNum;
    } catch (err) {
      console.error('Failed to check Arbitrum balance:', err);
      setArbUsdcBalance(0);
      return 0;
    } finally {
      setCheckingBalance(false);
    }
  }, [wallets.evmAddress]);

  // Check balance when EVM wallet connects
  useEffect(() => {
    if (wallets.evmAddress) {
      checkArbBalance();
    }
  }, [wallets.evmAddress, checkArbBalance]);

  // Check dYdX USDC balance
  const checkDydxBalance = useCallback(async () => {
    if (!wallets.keplrAddress) return;

    try {
      // Use LCD API to get dYdX balance
      const response = await fetch(`https://dydx-lcd.polkachu.com/cosmos/bank/v1beta1/balances/${wallets.keplrAddress}`);
      if (response.ok) {
        const data = await response.json();
        const usdcBalance = data.balances?.find(
          b => b.denom === CHAINS.dydx.usdcDenom
        );
        if (usdcBalance) {
          const balanceNum = Number(usdcBalance.amount) / 1e6;
          setDydxUsdcBalance(balanceNum);
          return balanceNum;
        }
      }
      setDydxUsdcBalance(0);
      return 0;
    } catch (err) {
      console.error('Failed to check dYdX balance:', err);
      setDydxUsdcBalance(null);
      return null;
    }
  }, [wallets.keplrAddress]);

  // Check dYdX balance when Keplr connects
  useEffect(() => {
    if (wallets.keplrAddress) {
      checkDydxBalance();
    }
  }, [wallets.keplrAddress, checkDydxBalance]);

  // Handle amount change with validation
  const handleAmountChange = useCallback((e) => {
    const value = e.target.value;
    setAmount(value);
    setAmountTouched(true);

    // Get appropriate balance based on direction
    const relevantBalance = direction === 'dydx-to-hl' ? dydxUsdcBalance : arbUsdcBalance;
    const validation = validateAmount(value, relevantBalance);
    setAmountErrors(validation.errors);
  }, [direction, dydxUsdcBalance, arbUsdcBalance]);

  // Handle amount blur (for showing errors after user leaves field)
  const handleAmountBlur = useCallback(() => {
    setAmountTouched(true);
    const relevantBalance = direction === 'dydx-to-hl' ? dydxUsdcBalance : arbUsdcBalance;
    const validation = validateAmount(amount, relevantBalance);
    setAmountErrors(validation.errors);
  }, [amount, direction, dydxUsdcBalance, arbUsdcBalance]);

  // Re-validate when direction or balances change
  useEffect(() => {
    if (amountTouched && amount) {
      const relevantBalance = direction === 'dydx-to-hl' ? dydxUsdcBalance : arbUsdcBalance;
      const validation = validateAmount(amount, relevantBalance);
      setAmountErrors(validation.errors);
    }
  }, [direction, dydxUsdcBalance, arbUsdcBalance, amount, amountTouched]);

  // Computed validation state for button
  const isAmountValid = amount && amountErrors.length === 0 && parseFloat(amount) >= VALIDATION.MIN_AMOUNT;

  // Send USDC from Arbitrum to Hyperliquid (Step 2 only)
  const sendToHyperliquid = async (amountToSend = null) => {
    setError(null);
    setStep(STEPS.BRIDGING_ARB_HL);
    
    try {
      if (!window.ethereum) {
        throw new Error('MetaMask not found');
      }

      // Ensure we're on Arbitrum
      try {
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        if (chainId !== '0xa4b1') {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0xa4b1' }]
          });
        }
      } catch (switchErr) {
        console.error('Chain switch error:', switchErr);
        throw new Error('Please switch to Arbitrum network in MetaMask');
      }

      // Create ethers provider and signer
      const provider = new window.ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // Get balance if no amount specified
      let sendAmount;
      if (amountToSend) {
        sendAmount = BigInt(Math.floor(amountToSend * 1e6));
      } else {
        const usdcContract = new window.ethers.Contract(
          CHAINS.arbitrum.usdcAddress,
          ['function balanceOf(address) view returns (uint256)'],
          provider
        );
        sendAmount = await usdcContract.balanceOf(wallets.evmAddress);
      }

      if (sendAmount <= 0) {
        throw new Error('No USDC balance on Arbitrum');
      }

      console.log('Sending to Hyperliquid:', Number(sendAmount) / 1e6, 'USDC');

      // Create USDC contract for transfer
      const usdcWithSigner = new window.ethers.Contract(
        CHAINS.arbitrum.usdcAddress,
        ['function transfer(address to, uint256 amount) returns (bool)'],
        signer
      );

      // Send to Hyperliquid bridge
      const tx = await usdcWithSigner.transfer(
        CHAINS.hyperliquid.bridgeAddress,
        sendAmount
      );
      
      console.log('TX sent:', tx.hash);
      setTxHashes(prev => ({ ...prev, lifiTx: tx.hash }));
      
      // Wait for confirmation
      await tx.wait();
      console.log('TX confirmed');
      
      setStep(STEPS.COMPLETE);

      // Update transaction history with success
      if (currentTxId) {
        updateTransaction(currentTxId, {
          status: TxStatusEnum.COMPLETE,
          txHashes: { ...txHashes, lifiTx: tx.hash }
        });
        setPendingCount(prev => Math.max(0, prev - 1));
      }

      // Refresh balance
      setTimeout(checkArbBalance, 2000);
      
      return tx.hash;
    } catch (err) {
      console.error('Hyperliquid transfer failed:', err);
      
      if (err.code === 4001 || err.code === 'ACTION_REJECTED' || err.message?.includes('rejected')) {
        setError('Transaction rejected by user');
      } else {
        setError(err.message || 'Transfer to Hyperliquid failed');
      }
      setStep(STEPS.ERROR);
      throw err;
    }
  };

  // Reset to idle state
  const resetBridge = () => {
    setStep(STEPS.IDLE);
    setError(null);
    setTxHashes({});
    checkArbBalance();
  };
  
  // Debounced quote fetching
  useEffect(() => {
    // Only fetch quotes if amount is valid
    const relevantBalance = direction === 'dydx-to-hl' ? dydxUsdcBalance : arbUsdcBalance;
    const validation = validateAmount(amount, relevantBalance);

    if (!validation.isValid || !wallets.isConnected) {
      setSkipRoute(null);
      setLifiRoute(null);
      return;
    }

    const timer = setTimeout(async () => {
      const amountNum = parseFloat(amount);
      
      if (direction === 'dydx-to-hl') {
        // Fetch Skip route (dYdX → Arbitrum)
        setSkipLoading(true);
        try {
          const route = await skipGoApi.getRoute(amountNum, wallets.keplrAddress, wallets.evmAddress);
          
          console.log('Skip route response:', JSON.stringify(route, null, 2));
          
          // Check for API error response
          if (route.error || route.message || !route.source_asset_chain_id) {
            throw new Error(route.message || route.error || 'Invalid route response');
          }
          
          setSkipRoute({
            raw: route,
            tool: 'Skip Go (CCTP)',
            estimatedTime: route.estimated_route_duration_seconds 
              ? `~${Math.ceil(route.estimated_route_duration_seconds / 60)} min` 
              : '~3-5 min',
            fee: route.estimated_fees?.[0]?.usd_amount || 0.5,
            outputAmount: amountNum - (route.estimated_fees?.[0]?.usd_amount || 0.5)
          });
        } catch (err) {
          console.error('Skip route error:', err);
          setSkipRoute({ error: err.message || 'Failed to fetch route' });
        }
        setSkipLoading(false);

        // Fetch LI.FI route (Arbitrum → Hyperliquid)
        setLifiLoading(true);
        try {
          // Use direct Hyperliquid bridge (no API call needed)
          const quote = hyperliquidBridge.getQuote(amountNum);
          
          setLifiRoute({
            tool: quote.tool,
            estimatedTime: quote.estimatedTime,
            fee: quote.fee,
            outputAmount: quote.outputAmount,
            bridgeAddress: quote.bridgeAddress
          });
        } catch (err) {
          console.error('Hyperliquid bridge error:', err);
          setLifiRoute({ error: err.message || 'Failed to get bridge info' });
        }
        setLifiLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [amount, direction, wallets.isConnected, wallets.keplrAddress, wallets.evmAddress, dydxUsdcBalance, arbUsdcBalance]);

  // Helper: Get USDC balance on Arbitrum
  const getArbitrumUsdcBalance = async (address) => {
    const provider = new window.ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');
    const usdcContract = new window.ethers.Contract(
      CHAINS.arbitrum.usdcAddress,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );
    const balance = await usdcContract.balanceOf(address);
    return balance;
  };

  // Helper: Wait for USDC arrival on Arbitrum with polling
  const waitForArbitrumFunds = async (address, initialBalance, timeout = 600000) => {
    const startTime = Date.now();
    const checkInterval = 10000; // Check every 10 seconds
    
    while (Date.now() - startTime < timeout) {
      await new Promise(r => setTimeout(r, checkInterval));
      const currentBalance = await getArbitrumUsdcBalance(address);
      if (currentBalance > initialBalance) {
        return currentBalance - initialBalance;
      }
    }
    throw new Error('Timeout waiting for funds on Arbitrum');
  };

  // Helper: Approve USDC spending for LI.FI
  const approveUsdcSpending = async (signer, spenderAddress, amount) => {
    const usdcContract = new window.ethers.Contract(
      CHAINS.arbitrum.usdcAddress,
      [
        'function allowance(address owner, address spender) view returns (uint256)',
        'function approve(address spender, uint256 amount) returns (bool)'
      ],
      signer
    );
    
    const ownerAddress = await signer.getAddress();
    const currentAllowance = await usdcContract.allowance(ownerAddress, spenderAddress);
    
    if (currentAllowance < amount) {
      const approveTx = await usdcContract.approve(spenderAddress, amount);
      await approveTx.wait();
    }
  };

  const executeBridge = async () => {
    if (!wallets.isConnected || !skipRoute || !lifiRoute) return;
    if (skipRoute.error || lifiRoute.error) return;
    
    setStep(STEPS.AWAITING_APPROVAL);
    setError(null);

    // Create transaction record in history
    const historyTx = addTransaction({
      amount: parseFloat(amount),
      direction: direction,
      status: TxStatusEnum.IN_PROGRESS,
      sourceAddress: wallets.keplrAddress,
      destAddress: wallets.evmAddress,
      currentStep: 1
    });
    setCurrentTxId(historyTx.id);
    setPendingCount(prev => prev + 1);

    let skipTxHash = null;
    
    // ============================================
    // STEP 1: Execute Skip transaction (dYdX → Arbitrum)
    // ============================================
    try {
      setStep(STEPS.BRIDGING_DYDX_ARB);
      
      // Get transaction messages from Skip API
      console.log('Skip route raw:', skipRoute.raw);
      
      const msgsResponse = await skipGoApi.getMsgs(skipRoute.raw, wallets.keplrAddress, wallets.evmAddress);
      
      console.log('Skip msgs response:', JSON.stringify(msgsResponse, null, 2));
      
      if (msgsResponse.error || msgsResponse.message) {
        throw new Error(msgsResponse.message || msgsResponse.error || 'Skip API error');
      }
      
      // Skip API v2 returns txs array with ready-to-sign transactions
      const txs = msgsResponse.txs;
      if (!txs || txs.length === 0) {
        throw new Error('No transactions returned from Skip API');
      }

      // Get Keplr signer
      if (!window.keplr) {
        throw new Error('Keplr wallet not found');
      }
      
      await window.keplr.enable('dydx-mainnet-1');
      
      // Process each transaction in the route
      for (const tx of txs) {
        const chainId = tx.chain_id || tx.chainID || 'dydx-mainnet-1';
        console.log('Processing tx for chain:', chainId);
        console.log('Full tx object:', JSON.stringify(tx, null, 2));
        
        // Check if this is a Cosmos tx
        if (tx.cosmos_tx) {
          const cosmosTx = tx.cosmos_tx;
          const msgs = cosmosTx.msgs || [];
          
          if (msgs.length === 0) {
            throw new Error('No messages in transaction');
          }
          
          console.log('Messages from Skip (count: ' + msgs.length + '):', JSON.stringify(msgs, null, 2));
          
          // Import cosmjs
          const { SigningStargateClient } = await import('@cosmjs/stargate');
          
          // Get the offline signer (Direct mode for protobuf)
          const offlineSigner = window.keplr.getOfflineSigner(chainId);
          
          // Connect to RPC
          const rpcEndpoint = chainId.includes('noble') 
            ? 'https://noble-rpc.polkachu.com'
            : 'https://dydx-rpc.polkachu.com';
          
          const client = await SigningStargateClient.connectWithSigner(rpcEndpoint, offlineSigner);
          
          // Build messages in cosmjs format
          const cosmjsMsgs = msgs.map((m, index) => {
            console.log(`Processing message ${index}:`, m);
            console.log(`Message type URL:`, m.msg_type_url || m.typeUrl);
            console.log(`Message content (type: ${typeof m.msg}):`, m.msg);
            
            // Get message value - could be in msg, value, or the message itself
            let msgValue = m.msg || m.value || m;
            
            // Parse if string
            if (typeof msgValue === 'string') {
              try {
                msgValue = JSON.parse(msgValue);
                console.log('Parsed string to object:', msgValue);
              } catch (e) {
                console.error('Failed to parse msg string:', e);
              }
            }
            
            const typeUrl = m.msg_type_url || m.typeUrl;
            console.log('Final msgValue:', msgValue);
            console.log('msgValue.token:', msgValue?.token);
            
            // For IBC transfer, we need to format it correctly
            if (typeUrl === '/ibc.applications.transfer.v1.MsgTransfer') {
              // Extract fields - handle both snake_case and camelCase
              const sourcePort = msgValue.source_port || msgValue.sourcePort || 'transfer';
              const sourceChannel = msgValue.source_channel || msgValue.sourceChannel;
              const timeoutHeight = msgValue.timeout_height || msgValue.timeoutHeight || {};
              const timeoutTimestamp = msgValue.timeout_timestamp || msgValue.timeoutTimestamp || '0';
              
              // Token extraction with fallback
              let token = msgValue.token;
              if (!token && msgValue.value?.token) {
                token = msgValue.value.token;
              }
              
              if (!token) {
                console.error('No token found in message. Full msgValue:', JSON.stringify(msgValue, null, 2));
                throw new Error('No token found in IBC transfer message');
              }
              
              const tokenDenom = token.denom;
              const tokenAmount = token.amount;
              
              console.log('Extracted token:', tokenDenom, tokenAmount);
              
              return {
                typeUrl: '/ibc.applications.transfer.v1.MsgTransfer',
                value: {
                  sourcePort: sourcePort,
                  sourceChannel: sourceChannel,
                  token: {
                    denom: tokenDenom,
                    amount: tokenAmount
                  },
                  sender: msgValue.sender,
                  receiver: msgValue.receiver,
                  timeoutHeight: {
                    revisionNumber: BigInt(timeoutHeight.revision_number || timeoutHeight.revisionNumber || '0'),
                    revisionHeight: BigInt(timeoutHeight.revision_height || timeoutHeight.revisionHeight || '0')
                  },
                  timeoutTimestamp: BigInt(timeoutTimestamp),
                  memo: msgValue.memo || ''
                }
              };
            }
            
            // Generic fallback for other message types
            console.log('Using generic fallback for message type:', typeUrl);
            return {
              typeUrl: typeUrl,
              value: msgValue
            };
          });
          
          console.log('Cosmjs messages:', JSON.stringify(cosmjsMsgs, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
          , 2));
          
          // Get account info for proper fee
          const accounts = await offlineSigner.getAccounts();
          const signerAddress = accounts[0].address;
          
          // Use USDC for fees on dYdX (they accept IBC USDC)
          const fee = {
            amount: [{
              denom: 'ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5',
              amount: '5000' // ~$0.005
            }],
            gas: '200000'
          };
          
          // Sign and broadcast
          const result = await client.signAndBroadcast(signerAddress, cosmjsMsgs, fee, '');
          
          console.log('Broadcast result:', result);
          
          if (result.code !== 0) {
            throw new Error(`Transaction failed: ${result.rawLog}`);
          }
          
          skipTxHash = result.transactionHash;
          setTxHashes(prev => ({ ...prev, skipTx: skipTxHash }));

          // Update transaction history with tx hash
          if (currentTxId) {
            updateTransaction(currentTxId, {
              txHashes: { skipTx: skipTxHash },
              currentStep: 2
            });
          }

          // Only process the first cosmos tx (dYdX -> Noble/Arbitrum)
          break;
        }
      }
      
      if (!skipTxHash) {
        throw new Error('No transaction was executed');
      }
      
      console.log('Step 1 complete. TX:', skipTxHash);
      
    } catch (err) {
      console.error('Step 1 (dYdX → Arbitrum) failed:', err);
      
      if (err.code === 4001 || err.code === 'ACTION_REJECTED' || err.message?.includes('rejected')) {
        setError('Transaction rejected by user');
      } else {
        setError(`Step 1 failed: ${err.message || 'Unknown error'}`);
      }
      setStep(STEPS.ERROR);

      // Update transaction history with failure
      if (currentTxId) {
        updateTransaction(currentTxId, {
          status: TxStatusEnum.FAILED,
          error: 'Step 1 failed'
        });
        setPendingCount(prev => Math.max(0, prev - 1));
      }
      return; // Don't continue if step 1 fails
    }

    // ============================================
    // STEP 2: Wait for funds on Arbitrum
    // ============================================
    try {
      setStep(STEPS.WAITING_ARB_FUNDS);
      
      // Get initial balance
      const initialBalance = await getArbitrumUsdcBalance(wallets.evmAddress);
      console.log('Initial Arbitrum balance:', Number(initialBalance) / 1e6);
      
      // Poll for balance increase (CCTP typically takes 3-10 minutes)
      const receivedAmount = await waitForArbitrumFunds(wallets.evmAddress, initialBalance);
      console.log(`Received ${Number(receivedAmount) / 1e6} USDC on Arbitrum`);
      
      // Update displayed balance
      await checkArbBalance();
      
    } catch (err) {
      console.error('Step 2 (waiting for Arbitrum funds) failed:', err);
      setError(`Funds sent from dYdX! CCTP bridge in progress. Use "Send to Hyperliquid" button once funds arrive on Arbitrum (~5-10 min).`);
      setStep(STEPS.ERROR);
      return; // User can use Resume button
    }

    // ============================================
    // STEP 3: Transfer USDC to Hyperliquid Bridge
    // ============================================
    try {
      await sendToHyperliquid();
    } catch (err) {
      // Error already handled in sendToHyperliquid
      console.error('Step 3 failed:', err);
    }
  };

  const totalFee = (parseFloat(skipRoute?.fee) || 0) + (parseFloat(lifiRoute?.fee) || 0);
  const finalOutput = parseFloat(lifiRoute?.outputAmount) || 0;

  return (
    <div className="app">
      <div className="background-grid" />
      <div className="background-glow" />
      
      <header>
        <div className="logo">
          <span className="logo-icon">⚡</span>
          <span className="logo-text">PERP BRIDGE</span>
        </div>
        <div className="subtitle">dYdX ↔ Hyperliquid Unified Bridge</div>
        <button className="history-btn" onClick={() => setHistoryOpen(true)}>
          History {pendingCount > 0 && <span className="pending-badge">{pendingCount}</span>}
        </button>
      </header>

      <main>
        <div className="card main-card">
          {/* Direction Toggle */}
          <div className="direction-toggle">
            <button 
              className={direction === 'dydx-to-hl' ? 'active' : ''}
              onClick={() => setDirection('dydx-to-hl')}
            >
              <span className="chain-logo" style={{ color: CHAINS.dydx.color }}>{CHAINS.dydx.logo}</span>
              dYdX → Hyperliquid
              <span className="chain-logo" style={{ color: CHAINS.hyperliquid.color }}>{CHAINS.hyperliquid.logo}</span>
            </button>
            <button 
              className={direction === 'hl-to-dydx' ? 'active' : ''}
              onClick={() => setDirection('hl-to-dydx')}
            >
              <span className="chain-logo" style={{ color: CHAINS.hyperliquid.color }}>{CHAINS.hyperliquid.logo}</span>
              Hyperliquid → dYdX
              <span className="chain-logo" style={{ color: CHAINS.dydx.color }}>{CHAINS.dydx.logo}</span>
            </button>
          </div>

          {/* Wallet Connections */}
          <div className="wallet-section">
            <div className="wallet-row">
              <div className="wallet-info">
                <span className="chain-badge" style={{ background: CHAINS.dydx.color }}>
                  {CHAINS.dydx.logo} dYdX
                </span>
                {wallets.keplrAddress ? (
                  <span className="address">{wallets.keplrAddress.slice(0, 10)}...{wallets.keplrAddress.slice(-6)}</span>
                ) : (
                  <span className="not-connected">Not connected</span>
                )}
              </div>
              <button 
                className={`wallet-btn ${wallets.keplrAddress ? 'connected' : ''}`}
                onClick={wallets.keplrAddress ? wallets.disconnectKeplr : wallets.connectKeplr}
                disabled={wallets.keplrConnecting}
              >
                {wallets.keplrConnecting ? 'Connecting...' : wallets.keplrAddress ? 'Disconnect' : 'Connect Keplr'}
              </button>
            </div>
            
            <div className="wallet-row">
              <div className="wallet-info">
                <span className="chain-badge" style={{ background: CHAINS.arbitrum.color }}>
                  {CHAINS.arbitrum.logo} EVM
                </span>
                {wallets.evmAddress ? (
                  <span className="address">{wallets.evmAddress.slice(0, 8)}...{wallets.evmAddress.slice(-6)}</span>
                ) : (
                  <span className="not-connected">Not connected</span>
                )}
              </div>
              <button 
                className={`wallet-btn ${wallets.evmAddress ? 'connected' : ''}`}
                onClick={wallets.evmAddress ? wallets.disconnectEvm : wallets.connectEvm}
                disabled={wallets.evmConnecting}
              >
                {wallets.evmConnecting ? 'Connecting...' : wallets.evmAddress ? 'Disconnect' : 'Connect MetaMask'}
              </button>
            </div>
          </div>

          {/* Amount Input */}
          <div className="amount-section">
            <div className="amount-label-row">
              <label>Amount (USDC)</label>
              {direction === 'dydx-to-hl' && dydxUsdcBalance !== null && (
                <span className="balance-hint">
                  Balance: {dydxUsdcBalance.toFixed(2)} USDC
                  <button
                    type="button"
                    className="max-btn"
                    onClick={() => {
                      setAmount(String(dydxUsdcBalance));
                      setAmountTouched(true);
                      setAmountErrors([]);
                    }}
                  >
                    MAX
                  </button>
                </span>
              )}
            </div>
            <div className={`amount-input-wrapper ${amountTouched && amountErrors.length > 0 ? 'has-error' : ''}`}>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={handleAmountChange}
                onBlur={handleAmountBlur}
                placeholder="0.00"
                autoComplete="off"
              />
              <span className="currency">USDC</span>
            </div>
            {amountTouched && amountErrors.length > 0 && (
              <div className="validation-errors">
                {amountErrors.map((err, i) => (
                  <span key={i} className="input-hint error">{err}</span>
                ))}
              </div>
            )}
          </div>

          {/* Route Flow Visualization */}
          {wallets.isConnected && isAmountValid && (
            <div className="route-flow">
              <div className="route-step">
                <div className="route-chain" style={{ borderColor: CHAINS.dydx.color }}>
                  <span className="chain-logo">{CHAINS.dydx.logo}</span>
                  <span>dYdX</span>
                  <span className="amount">{amount} USDC</span>
                </div>
              </div>
              
              <div className="route-arrow">
                <span className="arrow-label">Skip Go</span>
                <div className="arrow-line" />
                <span className="arrow-time">~3-5 min</span>
              </div>
              
              <div className="route-step">
                <div className="route-chain" style={{ borderColor: CHAINS.arbitrum.color }}>
                  <span className="chain-logo">{CHAINS.arbitrum.logo}</span>
                  <span>Arbitrum</span>
                  <span className="amount">{skipRoute?.outputAmount?.toFixed(2) || '...'} USDC</span>
                </div>
              </div>
              
              <div className="route-arrow">
                <span className="arrow-label">LI.FI</span>
                <div className="arrow-line" />
                <span className="arrow-time">~1-2 min</span>
              </div>
              
              <div className="route-step">
                <div className="route-chain" style={{ borderColor: CHAINS.hyperliquid.color }}>
                  <span className="chain-logo">{CHAINS.hyperliquid.logo}</span>
                  <span>Hyperliquid</span>
                  <span className="amount highlight">{finalOutput?.toFixed(2) || '...'} USDC</span>
                </div>
              </div>
            </div>
          )}

          {/* Quote Cards */}
          {wallets.isConnected && isAmountValid && (
            <div className="quotes-grid">
              <QuoteCard 
                title="Step 1: dYdX → Arbitrum"
                route={skipRoute}
                isLoading={skipLoading}
                error={skipRoute?.error}
              />
              <QuoteCard 
                title="Step 2: Arbitrum → Hyperliquid"
                route={lifiRoute}
                isLoading={lifiLoading}
                error={lifiRoute?.error}
              />
            </div>
          )}

          {/* Summary */}
          {skipRoute && lifiRoute && !skipRoute.error && !lifiRoute.error && (
            <div className="summary">
              <div className="summary-row">
                <span>Total Fees</span>
                <span>${totalFee.toFixed(2)}</span>
              </div>
              <div className="summary-row">
                <span>Estimated Time</span>
                <span>~4-7 minutes</span>
              </div>
              <div className="summary-row total">
                <span>You Receive</span>
                <span>{finalOutput.toFixed(2)} USDC</span>
              </div>
            </div>
          )}

          {/* Transaction Status */}
          <TxStatus step={step} txHashes={txHashes} />

          {/* Error Display */}
          {error && (
            <div className="error-banner">
              <span className="error-icon">⚠</span>
              {error}
            </div>
          )}

          {/* Action Button */}
          <button 
            className="bridge-btn"
            onClick={executeBridge}
            disabled={
              !wallets.isConnected ||
              !isAmountValid ||
              amountErrors.length > 0 ||
              skipLoading ||
              lifiLoading ||
              skipRoute?.error ||
              lifiRoute?.error ||
              (step !== STEPS.IDLE && step !== STEPS.COMPLETE && step !== STEPS.ERROR)
            }
          >
            {!wallets.isConnected
              ? 'Connect Wallets First'
              : !amount
                ? 'Enter Amount'
                : amountErrors.length > 0
                  ? 'Fix Validation Errors'
                  : skipLoading || lifiLoading
                    ? 'Fetching Routes...'
                    : step !== STEPS.IDLE && step !== STEPS.COMPLETE && step !== STEPS.ERROR
                      ? STEP_LABELS[step]
                      : `Bridge ${parseFloat(amount).toFixed(2)} USDC to Hyperliquid`
            }
          </button>

          {/* Arbitrum Balance & Resume Section */}
          {wallets.evmAddress && (
            <div className="resume-section">
              <div className="arb-balance">
                <span>Arbitrum USDC Balance:</span>
                <span className="balance-amount">
                  {checkingBalance ? 'Checking...' : arbUsdcBalance !== null ? `${arbUsdcBalance.toFixed(2)} USDC` : '--'}
                </span>
                <button 
                  className="refresh-btn" 
                  onClick={checkArbBalance}
                  disabled={checkingBalance}
                >
                  ↻
                </button>
              </div>
              
              {arbUsdcBalance > 0 && (
                <button 
                  className="resume-btn"
                  onClick={() => sendToHyperliquid()}
                  disabled={step === STEPS.BRIDGING_ARB_HL}
                >
                  {step === STEPS.BRIDGING_ARB_HL 
                    ? 'Sending...' 
                    : `Send ${arbUsdcBalance.toFixed(2)} USDC to Hyperliquid`}
                </button>
              )}
              
              {(step === STEPS.ERROR || step === STEPS.COMPLETE) && (
                <button className="reset-btn" onClick={resetBridge}>
                  {step === STEPS.COMPLETE ? 'Bridge Again' : 'Reset'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Info Panel */}
        <div className="info-panel">
          <h3>How it works</h3>
          <div className="info-steps">
            <div className="info-step">
              <span className="step-num">1</span>
              <div>
                <strong>dYdX → Arbitrum</strong>
                <p>Skip Go routes your USDC via CCTP (Circle's Cross-Chain Transfer Protocol) through Noble to Arbitrum. Takes ~5-10 min.</p>
              </div>
            </div>
            <div className="info-step">
              <span className="step-num">2</span>
              <div>
                <strong>Arbitrum → Hyperliquid</strong>
                <p>Direct transfer to Hyperliquid's Bridge2 contract, crediting your HyperCore account instantly.</p>
              </div>
            </div>
          </div>
          
          <div className="info-note">
            <span className="note-icon">💡</span>
            <p>If Step 1 completes but Step 2 fails, your USDC will be on Arbitrum. Use the "Send to Hyperliquid" button to resume.</p>
          </div>
        </div>
      </main>

      <footer>
        <div className="footer-links">
          <a href="https://docs.dydx.xyz" target="_blank" rel="noopener noreferrer">dYdX Docs</a>
          <a href="https://docs.li.fi" target="_blank" rel="noopener noreferrer">LI.FI Docs</a>
          <a href="https://docs.skip.build" target="_blank" rel="noopener noreferrer">Skip Docs</a>
          <a href="https://hyperliquid.gitbook.io" target="_blank" rel="noopener noreferrer">Hyperliquid Docs</a>
        </div>
        <p className="disclaimer">This is experimental software. Bridge at your own risk.</p>
      </footer>

      {/* Transaction History Modal */}
      <TransactionHistory
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        :root {
          --bg-primary: #0a0a0f;
          --bg-secondary: #12121a;
          --bg-tertiary: #1a1a25;
          --border: #2a2a3a;
          --text-primary: #e8e8f0;
          --text-secondary: #8888a0;
          --text-muted: #55556a;
          --accent-blue: #28A0F0;
          --accent-purple: #6966FF;
          --accent-green: #84CC16;
          --accent-yellow: #FACC15;
          --error: #EF4444;
          --success: #22C55E;
        }

        body {
          background: var(--bg-primary);
          color: var(--text-primary);
          font-family: 'Space Grotesk', sans-serif;
          min-height: 100vh;
        }

        .app {
          position: relative;
          min-height: 100vh;
          overflow: hidden;
        }

        .background-grid {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image: 
            linear-gradient(rgba(40, 160, 240, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(40, 160, 240, 0.03) 1px, transparent 1px);
          background-size: 50px 50px;
          pointer-events: none;
        }

        .background-glow {
          position: fixed;
          top: -50%;
          left: 50%;
          transform: translateX(-50%);
          width: 150%;
          height: 100%;
          background: radial-gradient(ellipse at center, rgba(105, 102, 255, 0.08) 0%, transparent 60%);
          pointer-events: none;
        }

        header {
          position: relative;
          padding: 2rem;
          text-align: center;
          border-bottom: 1px solid var(--border);
        }

        .logo {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .logo-icon {
          font-size: 2rem;
          color: var(--accent-yellow);
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.1); }
        }

        .logo-text {
          font-family: 'JetBrains Mono', monospace;
          font-size: 1.75rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .subtitle {
          color: var(--text-secondary);
          font-size: 0.9rem;
        }

        .history-btn {
          position: absolute;
          top: 1rem;
          right: 1.5rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text-secondary);
          font-family: inherit;
          font-size: 0.85rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .history-btn:hover {
          border-color: var(--accent-blue);
          color: var(--text-primary);
        }

        .pending-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 18px;
          height: 18px;
          padding: 0 4px;
          background: var(--accent-blue);
          border-radius: 9px;
          font-size: 0.7rem;
          font-weight: 600;
          color: white;
        }

        main {
          position: relative;
          max-width: 900px;
          margin: 0 auto;
          padding: 2rem;
          display: grid;
          gap: 2rem;
        }

        .card {
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 1.5rem;
        }

        .main-card {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .direction-toggle {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.5rem;
          background: var(--bg-tertiary);
          padding: 0.25rem;
          border-radius: 12px;
        }

        .direction-toggle button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          background: transparent;
          border: none;
          border-radius: 10px;
          color: var(--text-secondary);
          font-family: inherit;
          font-size: 0.85rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .direction-toggle button.active {
          background: var(--bg-secondary);
          color: var(--text-primary);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .direction-toggle button:hover:not(.active) {
          color: var(--text-primary);
        }

        .chain-logo {
          font-size: 1.1rem;
        }

        .wallet-section {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .wallet-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.75rem 1rem;
          background: var(--bg-tertiary);
          border-radius: 10px;
        }

        .wallet-info {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .chain-badge {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.35rem 0.75rem;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 600;
          color: white;
        }

        .address {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.85rem;
          color: var(--text-primary);
        }

        .not-connected {
          font-size: 0.85rem;
          color: var(--text-muted);
        }

        .wallet-btn {
          padding: 0.5rem 1rem;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text-primary);
          font-family: inherit;
          font-size: 0.8rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .wallet-btn:hover:not(:disabled) {
          background: var(--bg-primary);
          border-color: var(--accent-blue);
        }

        .wallet-btn.connected {
          border-color: var(--success);
          color: var(--success);
        }

        .wallet-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .amount-section {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .amount-section label {
          font-size: 0.85rem;
          color: var(--text-secondary);
          font-weight: 500;
        }

        .amount-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .amount-input-wrapper input {
          width: 100%;
          padding: 1rem 5rem 1rem 1rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: 12px;
          color: var(--text-primary);
          font-family: 'JetBrains Mono', monospace;
          font-size: 1.5rem;
          font-weight: 600;
          outline: none;
          transition: border-color 0.2s ease;
        }

        .amount-input-wrapper input:focus {
          border-color: var(--accent-blue);
        }

        .amount-input-wrapper input::placeholder {
          color: var(--text-muted);
        }

        .amount-input-wrapper .currency {
          position: absolute;
          right: 1rem;
          color: var(--text-secondary);
          font-weight: 600;
        }

        .input-hint {
          font-size: 0.8rem;
          color: var(--text-secondary);
        }

        .input-hint.error {
          color: var(--error);
        }

        .amount-label-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }

        .balance-hint {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8rem;
          color: var(--text-muted);
        }

        .max-btn {
          padding: 0.2rem 0.5rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: 4px;
          color: var(--accent-blue);
          font-size: 0.7rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .max-btn:hover {
          background: var(--accent-blue);
          color: white;
          border-color: var(--accent-blue);
        }

        .amount-input-wrapper.has-error input {
          border-color: var(--error);
        }

        .amount-input-wrapper.has-error input:focus {
          border-color: var(--error);
          box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
        }

        .validation-errors {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          margin-top: 0.5rem;
        }

        .route-flow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1.5rem 1rem;
          background: var(--bg-tertiary);
          border-radius: 12px;
          overflow-x: auto;
        }

        .route-step {
          flex-shrink: 0;
        }

        .route-chain {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
          padding: 1rem;
          background: var(--bg-secondary);
          border: 2px solid;
          border-radius: 12px;
          min-width: 100px;
        }

        .route-chain .chain-logo {
          font-size: 1.5rem;
        }

        .route-chain span {
          font-size: 0.8rem;
          color: var(--text-secondary);
        }

        .route-chain .amount {
          font-family: 'JetBrains Mono', monospace;
          font-weight: 600;
          color: var(--text-primary);
        }

        .route-chain .amount.highlight {
          color: var(--accent-green);
        }

        .route-arrow {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
          flex: 1;
          padding: 0 0.5rem;
        }

        .arrow-label {
          font-size: 0.7rem;
          font-weight: 600;
          color: var(--accent-blue);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .arrow-line {
          width: 100%;
          height: 2px;
          background: linear-gradient(90deg, var(--border), var(--accent-blue), var(--border));
          position: relative;
        }

        .arrow-line::after {
          content: '→';
          position: absolute;
          right: -0.5rem;
          top: 50%;
          transform: translateY(-50%);
          color: var(--accent-blue);
          font-size: 1rem;
        }

        .arrow-time {
          font-size: 0.7rem;
          color: var(--text-muted);
        }

        .quotes-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }

        @media (max-width: 600px) {
          .quotes-grid {
            grid-template-columns: 1fr;
          }
        }

        .quote-card {
          padding: 1rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: 10px;
        }

        .quote-card.loading {
          opacity: 0.7;
        }

        .quote-card.error {
          border-color: var(--error);
        }

        .quote-header {
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-secondary);
          margin-bottom: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .quote-loading {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          color: var(--text-muted);
          font-size: 0.85rem;
        }

        .spinner {
          width: 18px;
          height: 18px;
          border: 2px solid var(--border);
          border-top-color: var(--accent-blue);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .quote-error {
          color: var(--error);
          font-size: 0.85rem;
        }

        .quote-details {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .quote-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.85rem;
        }

        .quote-row .label {
          color: var(--text-muted);
        }

        .quote-row .value {
          color: var(--text-primary);
          font-weight: 500;
        }

        .quote-row .value.highlight {
          color: var(--accent-green);
        }

        .summary {
          padding: 1rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: 10px;
        }

        .summary-row {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem 0;
          font-size: 0.9rem;
          border-bottom: 1px solid var(--border);
        }

        .summary-row:last-child {
          border-bottom: none;
        }

        .summary-row.total {
          font-weight: 600;
          font-size: 1rem;
          color: var(--accent-green);
        }

        .tx-status {
          padding: 1rem;
          background: var(--bg-tertiary);
          border-radius: 10px;
        }

        .status-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-weight: 500;
          margin-bottom: 0.5rem;
        }

        .status-indicator {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--accent-blue);
          animation: blink 1s ease-in-out infinite;
        }

        .status-indicator.complete {
          background: var(--success);
          animation: none;
        }

        .status-indicator.error {
          background: var(--error);
          animation: none;
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .tx-link {
          display: inline-block;
          margin-right: 1rem;
          font-size: 0.8rem;
          color: var(--accent-blue);
          text-decoration: none;
        }

        .tx-link:hover {
          text-decoration: underline;
        }

        .error-banner {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid var(--error);
          border-radius: 10px;
          color: var(--error);
          font-size: 0.9rem;
        }

        .error-icon {
          font-size: 1.2rem;
        }

        .bridge-btn {
          width: 100%;
          padding: 1rem 1.5rem;
          background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
          border: none;
          border-radius: 12px;
          color: white;
          font-family: inherit;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .bridge-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(105, 102, 255, 0.3);
        }

        .bridge-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          background: var(--bg-tertiary);
          color: var(--text-muted);
        }

        .resume-section {
          margin-top: 1rem;
          padding: 1rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .arb-balance {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.9rem;
          color: var(--text-secondary);
        }

        .balance-amount {
          color: var(--accent-green);
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
        }

        .refresh-btn {
          padding: 0.25rem 0.5rem;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 1rem;
          transition: all 0.2s ease;
        }

        .refresh-btn:hover:not(:disabled) {
          background: var(--border);
          color: var(--text-primary);
        }

        .refresh-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .resume-btn {
          width: 100%;
          padding: 0.75rem 1rem;
          background: linear-gradient(135deg, #84CC16, #22C55E);
          border: none;
          border-radius: 10px;
          color: white;
          font-family: inherit;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .resume-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(132, 204, 22, 0.3);
        }

        .resume-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .reset-btn {
          width: 100%;
          padding: 0.5rem 1rem;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text-secondary);
          font-family: inherit;
          font-size: 0.85rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .reset-btn:hover {
          border-color: var(--text-muted);
          color: var(--text-primary);
        }

        .info-panel {
          padding: 1.5rem;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 16px;
        }

        .info-panel h3 {
          font-size: 1rem;
          font-weight: 600;
          margin-bottom: 1rem;
          color: var(--text-secondary);
        }

        .info-steps {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .info-step {
          display: flex;
          gap: 1rem;
        }

        .step-num {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: 50%;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--accent-blue);
          flex-shrink: 0;
        }

        .info-step strong {
          display: block;
          margin-bottom: 0.25rem;
          font-size: 0.9rem;
        }

        .info-step p {
          font-size: 0.8rem;
          color: var(--text-muted);
          line-height: 1.5;
        }

        .info-note {
          display: flex;
          gap: 0.75rem;
          margin-top: 1.5rem;
          padding: 1rem;
          background: rgba(250, 204, 21, 0.05);
          border: 1px solid rgba(250, 204, 21, 0.2);
          border-radius: 10px;
        }

        .note-icon {
          font-size: 1.2rem;
          flex-shrink: 0;
        }

        .info-note p {
          font-size: 0.85rem;
          color: var(--text-secondary);
          line-height: 1.5;
        }

        footer {
          position: relative;
          padding: 2rem;
          text-align: center;
          border-top: 1px solid var(--border);
          margin-top: 2rem;
        }

        .footer-links {
          display: flex;
          justify-content: center;
          gap: 2rem;
          margin-bottom: 1rem;
        }

        .footer-links a {
          color: var(--text-muted);
          text-decoration: none;
          font-size: 0.85rem;
          transition: color 0.2s ease;
        }

        .footer-links a:hover {
          color: var(--accent-blue);
        }

        .disclaimer {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        @media (max-width: 600px) {
          main {
            padding: 1rem;
          }
          
          .direction-toggle {
            grid-template-columns: 1fr;
          }
          
          .route-flow {
            flex-direction: column;
            gap: 0.5rem;
          }
          
          .route-arrow {
            transform: rotate(90deg);
            padding: 0.5rem 0;
          }
          
          .footer-links {
            flex-wrap: wrap;
            gap: 1rem;
          }
        }
      `}</style>
    </div>
  );
}

// Export with Error Boundary wrapper
export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
