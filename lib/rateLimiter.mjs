import Bottleneck from 'bottleneck';
import { logger } from './logger.mjs';

const hostLimiters = new Map();

const GLOBAL_CONCURRENCY = parseInt(process.env.GLOBAL_CONCURRENCY) || 8;
const PER_HOST_MIN_TIME = parseInt(process.env.PER_HOST_MIN_TIME_MS) || 1000;
const PER_HOST_MAX_CONCURRENT = parseInt(process.env.PER_HOST_MAX_CONCURRENT) || 1;

// Global limiter
const globalLimiter = new Bottleneck({
  maxConcurrent: GLOBAL_CONCURRENCY,
  minTime: 50 // Small delay between any requests
});

/**
 * Get or create a rate limiter for a specific host
 * @param {string} host - Hostname
 * @returns {Bottleneck} Rate limiter instance
 */
export function getHostLimiter(host) {
  if (!hostLimiters.has(host)) {
    const limiter = new Bottleneck({
      maxConcurrent: PER_HOST_MAX_CONCURRENT, // Max 1 concurrent request per host
      minTime: PER_HOST_MIN_TIME,              // Min 1 second between requests
      reservoir: 10,                           // Burst: 10 requests
      reservoirRefreshAmount: 10,
      reservoirRefreshInterval: 60 * 1000      // Refill every minute
    });
    
    limiter.on('failed', async (error, jobInfo) => {
      logger.warn('Rate limiter job failed', { host, error: error.message, retries: jobInfo.retryCount });
      if (jobInfo.retryCount < 2) {
        return 2000; // Retry after 2 seconds
      }
    });
    
    hostLimiters.set(host, limiter);
    logger.debug('Created rate limiter', { host, minTime: PER_HOST_MIN_TIME });
  }
  
  return hostLimiters.get(host);
}

/**
 * Execute a function with rate limiting (both global and per-host)
 * @param {string} url - URL being fetched
 * @param {Function} fn - Function to execute
 * @returns {Promise} Result of function execution
 */
export async function withRateLimit(url, fn) {
  const { hostname } = new URL(url);
  const hostLimiter = getHostLimiter(hostname);
  
  return globalLimiter.schedule(() =>
    hostLimiter.schedule(() => fn())
  );
}

/**
 * Clear all rate limiters (useful for testing)
 */
export function clearLimiters() {
  for (const limiter of hostLimiters.values()) {
    limiter.stop();
  }
  hostLimiters.clear();
  globalLimiter.stop({ dropWaitingJobs: true });
}

