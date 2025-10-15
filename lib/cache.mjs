import { createHash } from 'crypto';
import { logger } from './logger.mjs';

const ENABLE_CACHE = process.env.ENABLE_CACHE !== 'false';
const CACHE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Generate cache key from URL
 * @param {string} url
 * @returns {string}
 */
function cacheKey(url) {
  const hash = createHash('sha256').update(url).digest('hex');
  return `crawl:${hash}`;
}

/**
 * Get cached crawl result
 * @param {string} url
 * @param {Redis} redis
 * @returns {Promise<Object|null>}
 */
export async function getCached(url, redis) {
  if (!ENABLE_CACHE || !redis) return null;
  
  try {
    const key = cacheKey(url);
    const cached = await redis.get(key);
    
    if (cached) {
      logger.debug('Cache hit', { url });
      return JSON.parse(cached);
    }
    
    return null;
  } catch (err) {
    logger.error('Cache get error', { url, error: err.message });
    return null;
  }
}

/**
 * Set cached crawl result
 * @param {string} url
 * @param {Object} data
 * @param {Redis} redis
 * @param {number} ttl - TTL in seconds
 * @returns {Promise<void>}
 */
export async function setCached(url, data, redis, ttl = CACHE_TTL) {
  if (!ENABLE_CACHE || !redis) return;
  
  try {
    const key = cacheKey(url);
    await redis.setex(key, ttl, JSON.stringify(data));
    logger.debug('Cache set', { url, ttl });
  } catch (err) {
    logger.error('Cache set error', { url, error: err.message });
  }
}

/**
 * Clear cache for a URL
 * @param {string} url
 * @param {Redis} redis
 * @returns {Promise<void>}
 */
export async function clearCached(url, redis) {
  if (!redis) return;
  
  try {
    const key = cacheKey(url);
    await redis.del(key);
    logger.debug('Cache cleared', { url });
  } catch (err) {
    logger.error('Cache clear error', { url, error: err.message });
  }
}

