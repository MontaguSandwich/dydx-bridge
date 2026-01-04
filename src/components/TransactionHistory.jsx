import React, { useState, useEffect, useCallback } from 'react';
import {
  getTransactions,
  clearHistory,
  deleteTransaction,
  formatTimestamp,
  getDirectionDisplay,
  getStatusDisplay,
  TxStatusEnum
} from '../services/history.js';

/**
 * TransactionHistory Component
 * Displays bridge transaction history with localStorage persistence
 */
export function TransactionHistory({ isOpen, onClose, onResume }) {
  const [transactions, setTransactions] = useState([]);
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  // Load transactions on mount and when opened
  const loadTransactions = useCallback(() => {
    setTransactions(getTransactions());
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadTransactions();
    }
  }, [isOpen, loadTransactions]);

  // Handle clear all
  const handleClearAll = () => {
    clearHistory();
    setTransactions([]);
    setShowConfirmClear(false);
  };

  // Handle delete single transaction
  const handleDelete = (id) => {
    deleteTransaction(id);
    loadTransactions();
  };

  // Handle resume transaction
  const handleResume = (tx) => {
    if (onResume) {
      onResume(tx);
    }
    onClose();
  };

  if (!isOpen) return null;

  const pendingTxs = transactions.filter(
    tx => tx.status === TxStatusEnum.PENDING || tx.status === TxStatusEnum.IN_PROGRESS
  );
  const completedTxs = transactions.filter(
    tx => tx.status === TxStatusEnum.COMPLETE || tx.status === TxStatusEnum.FAILED
  );

  return (
    <div className="history-overlay" onClick={onClose}>
      <div className="history-modal" onClick={e => e.stopPropagation()}>
        <div className="history-header">
          <h2>Transaction History</h2>
          <button className="close-btn" onClick={onClose}>x</button>
        </div>

        <div className="history-content">
          {transactions.length === 0 ? (
            <div className="history-empty">
              <p>No transactions yet</p>
              <span className="empty-hint">Your bridge transactions will appear here</span>
            </div>
          ) : (
            <>
              {/* Pending Transactions */}
              {pendingTxs.length > 0 && (
                <div className="history-section">
                  <h3>Pending</h3>
                  <div className="tx-list">
                    {pendingTxs.map(tx => (
                      <TransactionCard
                        key={tx.id}
                        tx={tx}
                        onDelete={handleDelete}
                        onResume={handleResume}
                        showResume={true}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Completed Transactions */}
              {completedTxs.length > 0 && (
                <div className="history-section">
                  <h3>History</h3>
                  <div className="tx-list">
                    {completedTxs.map(tx => (
                      <TransactionCard
                        key={tx.id}
                        tx={tx}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {transactions.length > 0 && (
          <div className="history-footer">
            {showConfirmClear ? (
              <div className="confirm-clear">
                <span>Clear all history?</span>
                <button className="confirm-yes" onClick={handleClearAll}>Yes, clear</button>
                <button className="confirm-no" onClick={() => setShowConfirmClear(false)}>Cancel</button>
              </div>
            ) : (
              <button className="clear-btn" onClick={() => setShowConfirmClear(true)}>
                Clear History
              </button>
            )}
          </div>
        )}

        <style>{`
          .history-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            backdrop-filter: blur(4px);
          }

          .history-modal {
            background: var(--bg-secondary, #12121a);
            border: 1px solid var(--border, #2a2a3a);
            border-radius: 16px;
            width: 90%;
            max-width: 500px;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }

          .history-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 1.25rem 1.5rem;
            border-bottom: 1px solid var(--border, #2a2a3a);
          }

          .history-header h2 {
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--text-primary, #e8e8f0);
            margin: 0;
          }

          .close-btn {
            background: none;
            border: none;
            color: var(--text-secondary, #8888a0);
            font-size: 1.5rem;
            cursor: pointer;
            padding: 0;
            line-height: 1;
            transition: color 0.2s;
          }

          .close-btn:hover {
            color: var(--text-primary, #e8e8f0);
          }

          .history-content {
            flex: 1;
            overflow-y: auto;
            padding: 1rem 1.5rem;
          }

          .history-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 3rem 1rem;
            text-align: center;
          }

          .history-empty p {
            color: var(--text-secondary, #8888a0);
            font-size: 1rem;
            margin: 0 0 0.5rem 0;
          }

          .empty-hint {
            color: var(--text-muted, #55556a);
            font-size: 0.85rem;
          }

          .history-section {
            margin-bottom: 1.5rem;
          }

          .history-section:last-child {
            margin-bottom: 0;
          }

          .history-section h3 {
            font-size: 0.75rem;
            font-weight: 600;
            color: var(--text-muted, #55556a);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin: 0 0 0.75rem 0;
          }

          .tx-list {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
          }

          .history-footer {
            padding: 1rem 1.5rem;
            border-top: 1px solid var(--border, #2a2a3a);
          }

          .clear-btn {
            width: 100%;
            padding: 0.6rem 1rem;
            background: transparent;
            border: 1px solid var(--border, #2a2a3a);
            border-radius: 8px;
            color: var(--text-muted, #55556a);
            font-size: 0.85rem;
            cursor: pointer;
            transition: all 0.2s;
          }

          .clear-btn:hover {
            border-color: var(--error, #EF4444);
            color: var(--error, #EF4444);
          }

          .confirm-clear {
            display: flex;
            align-items: center;
            gap: 0.75rem;
          }

          .confirm-clear span {
            flex: 1;
            color: var(--text-secondary, #8888a0);
            font-size: 0.85rem;
          }

          .confirm-yes,
          .confirm-no {
            padding: 0.5rem 1rem;
            border-radius: 6px;
            font-size: 0.8rem;
            cursor: pointer;
            transition: all 0.2s;
          }

          .confirm-yes {
            background: var(--error, #EF4444);
            border: none;
            color: white;
          }

          .confirm-yes:hover {
            background: #dc2626;
          }

          .confirm-no {
            background: transparent;
            border: 1px solid var(--border, #2a2a3a);
            color: var(--text-secondary, #8888a0);
          }

          .confirm-no:hover {
            border-color: var(--text-muted, #55556a);
            color: var(--text-primary, #e8e8f0);
          }
        `}</style>
      </div>
    </div>
  );
}

/**
 * Transaction Card Component
 */
function TransactionCard({ tx, onDelete, onResume, showResume }) {
  const statusInfo = getStatusDisplay(tx.status);
  const isPending = tx.status === TxStatusEnum.PENDING || tx.status === TxStatusEnum.IN_PROGRESS;

  return (
    <div className="tx-card">
      <div className="tx-main">
        <div className="tx-info">
          <div className="tx-amount">{tx.amount.toFixed(2)} USDC</div>
          <div className="tx-direction">{getDirectionDisplay(tx.direction)}</div>
        </div>
        <div className="tx-meta">
          <span
            className="tx-status"
            style={{ color: statusInfo.color }}
          >
            {isPending && <span className="status-dot" style={{ background: statusInfo.color }} />}
            {statusInfo.label}
          </span>
          <span className="tx-time">{formatTimestamp(tx.timestamp)}</span>
        </div>
      </div>

      {/* Transaction hashes */}
      {(tx.txHashes?.skipTx || tx.txHashes?.lifiTx) && (
        <div className="tx-hashes">
          {tx.txHashes.skipTx && (
            <a
              href={`https://www.mintscan.io/dydx/tx/${tx.txHashes.skipTx}`}
              target="_blank"
              rel="noopener noreferrer"
              className="tx-hash-link"
            >
              dYdX TX
            </a>
          )}
          {tx.txHashes.lifiTx && (
            <a
              href={`https://arbiscan.io/tx/${tx.txHashes.lifiTx}`}
              target="_blank"
              rel="noopener noreferrer"
              className="tx-hash-link"
            >
              Arbitrum TX
            </a>
          )}
        </div>
      )}

      {/* Error message */}
      {tx.error && (
        <div className="tx-error">{tx.error}</div>
      )}

      {/* Actions */}
      <div className="tx-actions">
        {showResume && isPending && onResume && (
          <button className="resume-action" onClick={() => onResume(tx)}>
            Resume
          </button>
        )}
        <button className="delete-action" onClick={() => onDelete(tx.id)}>
          Remove
        </button>
      </div>

      <style>{`
        .tx-card {
          background: var(--bg-tertiary, #1a1a25);
          border: 1px solid var(--border, #2a2a3a);
          border-radius: 10px;
          padding: 1rem;
        }

        .tx-main {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .tx-info {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .tx-amount {
          font-family: 'JetBrains Mono', monospace;
          font-size: 1rem;
          font-weight: 600;
          color: var(--text-primary, #e8e8f0);
        }

        .tx-direction {
          font-size: 0.8rem;
          color: var(--text-muted, #55556a);
        }

        .tx-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.25rem;
        }

        .tx-status {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.8rem;
          font-weight: 500;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          animation: pulse-dot 1.5s ease-in-out infinite;
        }

        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .tx-time {
          font-size: 0.75rem;
          color: var(--text-muted, #55556a);
        }

        .tx-hashes {
          display: flex;
          gap: 0.75rem;
          margin-top: 0.75rem;
          padding-top: 0.75rem;
          border-top: 1px solid var(--border, #2a2a3a);
        }

        .tx-hash-link {
          font-size: 0.75rem;
          color: var(--accent-blue, #28A0F0);
          text-decoration: none;
        }

        .tx-hash-link:hover {
          text-decoration: underline;
        }

        .tx-error {
          margin-top: 0.5rem;
          padding: 0.5rem;
          background: rgba(239, 68, 68, 0.1);
          border-radius: 6px;
          font-size: 0.75rem;
          color: var(--error, #EF4444);
        }

        .tx-actions {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.75rem;
          padding-top: 0.75rem;
          border-top: 1px solid var(--border, #2a2a3a);
        }

        .resume-action,
        .delete-action {
          padding: 0.4rem 0.75rem;
          border-radius: 6px;
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .resume-action {
          background: var(--accent-blue, #28A0F0);
          border: none;
          color: white;
        }

        .resume-action:hover {
          background: #1d8ed4;
        }

        .delete-action {
          background: transparent;
          border: 1px solid var(--border, #2a2a3a);
          color: var(--text-muted, #55556a);
        }

        .delete-action:hover {
          border-color: var(--error, #EF4444);
          color: var(--error, #EF4444);
        }
      `}</style>
    </div>
  );
}

export default TransactionHistory;
