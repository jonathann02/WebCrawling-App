import { setTimeout as delay } from 'node:timers/promises';
import { logger } from './logger.mjs';
import { crawlCounter, crawlDuration } from './metrics.mjs';

const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS) || 12000;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;
const BOT_USER_AGENT = process.env.BOT_NAME || 'CSV-Webcrawler/2.0';

/**
 * Fetch HTML with exponential backoff, jitter, and realistic headers
 * @param {string} url - URL to fetch
 * @param {number} attempt - Current retry attempt (0-indexed)
 * @returns {Promise<string>} HTML content
 */
export async function fetchHtml(url, attempt = 0) {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': BOT_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    
    // Handle server errors with retry
    if (!res.ok && res.status >= 500 && attempt < MAX_RETRIES) {
      const backoff = Math.min(1000 * Math.pow(2, attempt), 8000);
      const jitter = Math.random() * 1000;
      const retryDelay = backoff + jitter;
      
      logger.warn('Server error, retrying', { 
        url, 
        status: res.status, 
        attempt: attempt + 1, 
        retryDelay: Math.round(retryDelay) 
      });
      
      await delay(retryDelay);
      return fetchHtml(url, attempt + 1);
    }
    
    // Handle client errors
    if (!res.ok) {
      const { hostname } = new URL(url);
      
      if (res.status === 403 || res.status === 429) {
        crawlCounter.inc({ status: 'blocked', host: hostname });
        logger.warn('Request blocked', { url, status: res.status });
      } else if (res.status === 404) {
        crawlCounter.inc({ status: '404', host: hostname });
      } else {
        crawlCounter.inc({ status: 'error', host: hostname });
      }
      
      throw new Error(`HTTP ${res.status}`);
    }
    
    // Verify content type
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      const { hostname } = new URL(url);
      crawlCounter.inc({ status: 'non-html', host: hostname });
      throw new Error(`Non-HTML content: ${contentType}`);
    }
    
    const html = await res.text();
    
    // Success metrics
    const duration = (Date.now() - startTime) / 1000;
    const { hostname } = new URL(url);
    crawlCounter.inc({ status: 'success', host: hostname });
    crawlDuration.observe(duration);
    
    logger.debug('Fetch successful', { url, duration: duration.toFixed(2) + 's', size: html.length });
    
    return html;
    
  } catch (err) {
    const { hostname } = new URL(url);
    
    if (err.name === 'AbortError') {
      crawlCounter.inc({ status: 'timeout', host: hostname });
      logger.warn('Request timeout', { url, timeout: REQUEST_TIMEOUT_MS });
    } else {
      crawlCounter.inc({ status: 'error', host: hostname });
      logger.error('Fetch failed', { url, error: err.message, attempt });
    }
    
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

