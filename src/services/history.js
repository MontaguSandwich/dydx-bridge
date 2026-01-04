/**
 * Transaction History Service
 * Persists bridge transaction history to localStorage
 */

const STORAGE_KEY = 'perp-bridge-history';
const MAX_HISTORY_ITEMS = 50;

/**
 * Transaction status enum
 */
export const TxStatusEnum = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETE: 'complete',
  FAILED: 'failed'
};

/**
 * Get all transactions from localStorage
 * @returns {Array} Array of transaction objects
 */
export function getTransactions() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to load transaction history:', err);
    return [];
  }
}

/**
 * Save transactions to localStorage
 * @param {Array} transactions - Array of transaction objects
 */
function saveTransactions(transactions) {
  try {
    // Keep only the most recent transactions
    const trimmed = transactions.slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.error('Failed to save transaction history:', err);
  }
}

/**
 * Add a new transaction to history
 * @param {Object} tx - Transaction details
 * @returns {Object} The created transaction
 */
export function addTransaction(tx) {
  const transactions = getTransactions();

  const newTx = {
    id: tx.id || generateTxId(),
    timestamp: Date.now(),
    amount: tx.amount,
    direction: tx.direction,
    status: tx.status || TxStatusEnum.PENDING,
    sourceAddress: tx.sourceAddress,
    destAddress: tx.destAddress,
    txHashes: tx.txHashes || {},
    currentStep: tx.currentStep || 1,
    error: null
  };

  // Add to beginning of array (most recent first)
  transactions.unshift(newTx);
  saveTransactions(transactions);

  return newTx;
}

/**
 * Update an existing transaction
 * @param {string} id - Transaction ID
 * @param {Object} updates - Fields to update
 * @returns {Object|null} Updated transaction or null if not found
 */
export function updateTransaction(id, updates) {
  const transactions = getTransactions();
  const index = transactions.findIndex(tx => tx.id === id);

  if (index === -1) return null;

  transactions[index] = {
    ...transactions[index],
    ...updates,
    updatedAt: Date.now()
  };

  saveTransactions(transactions);
  return transactions[index];
}

/**
 * Get a single transaction by ID
 * @param {string} id - Transaction ID
 * @returns {Object|null} Transaction or null if not found
 */
export function getTransaction(id) {
  const transactions = getTransactions();
  return transactions.find(tx => tx.id === id) || null;
}

/**
 * Get pending/in-progress transactions
 * @returns {Array} Array of pending transactions
 */
export function getPendingTransactions() {
  const transactions = getTransactions();
  return transactions.filter(
    tx => tx.status === TxStatusEnum.PENDING || tx.status === TxStatusEnum.IN_PROGRESS
  );
}

/**
 * Clear all transaction history
 */
export function clearHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear history:', err);
  }
}

/**
 * Delete a single transaction from history
 * @param {string} id - Transaction ID to delete
 */
export function deleteTransaction(id) {
  const transactions = getTransactions();
  const filtered = transactions.filter(tx => tx.id !== id);
  saveTransactions(filtered);
}

/**
 * Generate a unique transaction ID
 * @returns {string} Unique ID
 */
function generateTxId() {
  return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Format timestamp for display
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Formatted date string
 */
export function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Get direction display text
 * @param {string} direction - Direction code
 * @returns {string} Human readable direction
 */
export function getDirectionDisplay(direction) {
  return direction === 'dydx-to-hl'
    ? 'dYdX → Hyperliquid'
    : 'Hyperliquid → dYdX';
}

/**
 * Get status display info
 * @param {string} status - Status code
 * @returns {Object} Status display info with label and color
 */
export function getStatusDisplay(status) {
  switch (status) {
    case TxStatusEnum.PENDING:
      return { label: 'Pending', color: '#FACC15' };
    case TxStatusEnum.IN_PROGRESS:
      return { label: 'In Progress', color: '#28A0F0' };
    case TxStatusEnum.COMPLETE:
      return { label: 'Complete', color: '#22C55E' };
    case TxStatusEnum.FAILED:
      return { label: 'Failed', color: '#EF4444' };
    default:
      return { label: 'Unknown', color: '#8888a0' };
  }
}
