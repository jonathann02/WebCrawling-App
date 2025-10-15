import { isIP } from 'net';
import dns from 'dns/promises';
import { logger } from '../logger.mjs';

const BLOCKED_IP_PATTERNS = [
  /^127\./,                           // localhost
  /^10\./,                            // private
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // private
  /^192\.168\./,                      // private
  /^169\.254\./,                      // link-local
  /^::1$/,                            // IPv6 localhost
  /^fe80:/,                           // IPv6 link-local
  /^fc00:/,                           // IPv6 unique local
  /^0\./,                             // Invalid
];

/**
 * Check if URL is safe (SSRF protection)
 * @param {string} url - URL to validate
 * @returns {Promise<{safe: boolean, reason?: string}>}
 */
export async function isSafeUrl(url) {
  try {
    const u = new URL(url);
    
    // Only allow HTTP(S)
    if (!['http:', 'https:'].includes(u.protocol)) {
      return { safe: false, reason: 'Invalid protocol (only HTTP/HTTPS allowed)' };
    }
    
    // Check if hostname is an IP address
    if (isIP(u.hostname)) {
      if (BLOCKED_IP_PATTERNS.some(pattern => pattern.test(u.hostname))) {
        logger.warn('SSRF attempt: Private IP blocked', { url, ip: u.hostname });
        return { safe: false, reason: 'Private IP address blocked' };
      }
    }
    
    // DNS resolution check (prevent DNS rebinding)
    try {
      const addresses = await dns.resolve4(u.hostname);
      for (const addr of addresses) {
        if (BLOCKED_IP_PATTERNS.some(pattern => pattern.test(addr))) {
          logger.warn('SSRF attempt: DNS resolves to private IP', { url, hostname: u.hostname, ip: addr });
          return { safe: false, reason: 'Domain resolves to private IP' };
        }
      }
    } catch (dnsErr) {
      // DNS resolution failed - might be IPv6 only or invalid domain
      logger.debug('DNS resolution failed', { url, hostname: u.hostname, error: dnsErr.message });
      // We'll allow it but it will likely fail on fetch anyway
    }
    
    return { safe: true };
    
  } catch (err) {
    return { safe: false, reason: 'Invalid URL format' };
  }
}

/**
 * Validate concurrency setting
 */
export function validateConcurrency(value) {
  const n = Number(value);
  if (isNaN(n) || n < 1 || n > 8) {
    return { valid: false, value: 4, message: 'Concurrency måste vara mellan 1-8' };
  }
  return { valid: true, value: Math.floor(n) };
}

/**
 * Validate max pages setting
 */
export function validateMaxPages(value) {
  const n = Number(value);
  if (isNaN(n) || n < 1 || n > 10) {
    return { valid: false, value: 5, message: 'Max sidor måste vara mellan 1-10' };
  }
  return { valid: true, value: Math.floor(n) };
}

/**
 * Sanitize tags input (prevent injection)
 */
export function sanitizeTags(value) {
  if (!value) return '';
  return String(value)
    .replace(/[^\w\s,åäöÅÄÖ-]/g, '')
    .slice(0, 100);
}

