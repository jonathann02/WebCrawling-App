import robotsParser from 'robots-parser';
import NodeCache from 'node-cache';
import { logger } from './logger.mjs';

const cache = new NodeCache({ stdTTL: 3600 }); // 1h cache

/**
 * Check if URL is allowed by robots.txt
 * @param {string} url - URL to check
 * @param {string} userAgent - User agent string
 * @returns {Promise<{allowed: boolean, crawlDelay: number}>}
 */
export async function isAllowed(url, userAgent = process.env.BOT_NAME || 'CSV-Webcrawler/2.0') {
  try {
    const { origin, pathname } = new URL(url);
    const robotsUrl = `${origin}/robots.txt`;
    
    let robots = cache.get(robotsUrl);
    if (!robots) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        
        const res = await fetch(robotsUrl, { 
          signal: controller.signal,
          headers: { 'User-Agent': userAgent }
        });
        clearTimeout(timeout);
        
        const txt = res.ok ? await res.text() : 'User-agent: *\nAllow: /';
        robots = robotsParser(robotsUrl, txt);
        cache.set(robotsUrl, robots);
        
        logger.debug('Fetched robots.txt', { origin, allowed: robots.isAllowed(pathname, userAgent) });
      } catch (err) {
        // On error, assume permissive
        logger.warn('Failed to fetch robots.txt, assuming permissive', { origin, error: err.message });
        robots = robotsParser(robotsUrl, 'User-agent: *\nAllow: /');
        cache.set(robotsUrl, robots);
      }
    }
    
    const allowed = robots.isAllowed(pathname, userAgent);
    const crawlDelay = robots.getCrawlDelay(userAgent) || 0;
    
    return { allowed, crawlDelay };
  } catch (err) {
    logger.error('Error checking robots.txt', { url, error: err.message });
    return { allowed: true, crawlDelay: 0 }; // Permissive fallback
  }
}

/**
 * Clear robots.txt cache (useful for testing)
 */
export function clearCache() {
  cache.flushAll();
}

