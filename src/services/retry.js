/**
 * Retry Utility
 * Provides exponential backoff retry logic with configurable options
 */

// Error types that are worth retrying
const TRANSIENT_ERROR_CODES = [
  408, // Request Timeout
  429, // Too Many Requests (Rate Limited)
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
];

/**
 * Check if an error is transient (worth retrying)
 */
export function isTransientError(error) {
  // Network failures are always transient
  if (error.name === 'TypeError' && error.message.includes('fetch')) {
    return true;
  }

  // Check for timeout errors
  if (error.name === 'AbortError' || error.message?.includes('timeout')) {
    return true;
  }

  // Check for rate limiting
  if (error.message?.includes('rate limit') || error.message?.includes('429')) {
    return true;
  }

  // Check HTTP status codes
  if (error.status && TRANSIENT_ERROR_CODES.includes(error.status)) {
    return true;
  }

  return false;
}

/**
 * Create an error with additional context
 */
export function createError(message, originalError, context = {}) {
  const error = new Error(message);
  error.originalError = originalError;
  error.context = context;
  error.isRetryable = isTransientError(originalError);
  return error;
}

/**
 * Fetch with timeout support
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Retry a function with exponential backoff
 *
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxAttempts - Maximum number of attempts (default: 3)
 * @param {number} options.initialDelayMs - Initial delay in milliseconds (default: 1000)
 * @param {number} options.maxDelayMs - Maximum delay between retries (default: 10000)
 * @param {number} options.backoffMultiplier - Multiplier for exponential backoff (default: 2)
 * @param {Function} options.shouldRetry - Custom function to determine if error is retryable
 * @param {Function} options.onRetry - Callback when a retry occurs
 * @returns {Promise} - Result of the function
 */
export async function retry(fn, options = {}) {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    shouldRetry = isTransientError,
    onRetry = null,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const baseDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
      const jitter = Math.random() * 0.3 * baseDelay; // Add 0-30% jitter
      const delay = Math.min(baseDelay + jitter, maxDelayMs);

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(error, attempt, delay);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Parse error response from API
 */
export async function parseErrorResponse(response) {
  let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
  let errorData = null;

  try {
    errorData = await response.json();
    errorMessage = errorData.message || errorData.error || errorMessage;
  } catch {
    // Response was not JSON, use status text
  }

  const error = new Error(errorMessage);
  error.status = response.status;
  error.data = errorData;
  return error;
}

/**
 * Format user-friendly error message
 */
export function formatUserError(error, context = '') {
  const prefix = context ? `${context}: ` : '';

  // Rate limiting
  if (error.status === 429 || error.message?.includes('rate limit')) {
    return `${prefix}Rate limited. Please wait a moment and try again.`;
  }

  // Network/timeout errors
  if (error.name === 'AbortError' || error.message?.includes('timeout')) {
    return `${prefix}Request timed out. Please check your connection and try again.`;
  }

  if (error.name === 'TypeError' && error.message?.includes('fetch')) {
    return `${prefix}Network error. Please check your internet connection.`;
  }

  // Server errors
  if (error.status >= 500) {
    return `${prefix}Service temporarily unavailable. Please try again later.`;
  }

  // Client errors with specific messages
  if (error.status === 400) {
    return `${prefix}${error.message || 'Invalid request. Please check your input.'}`;
  }

  if (error.status === 404) {
    return `${prefix}Route not found. The requested resource may not exist.`;
  }

  // Default to original message
  return `${prefix}${error.message || 'An unexpected error occurred.'}`;
}

export default {
  retry,
  fetchWithTimeout,
  isTransientError,
  createError,
  parseErrorResponse,
  formatUserError,
};
