import { logger } from './logger.mjs';

/**
 * Do-Not-Contact list - domains that should not be crawled
 * Add domains here that have requested to be excluded
 */
const DNC_LIST = new Set([
  // Government sites
  'regeringen.se',
  'riksdagen.se',
  'polisen.se',
  'skatteverket.se',
  'kronofogden.se',
  
  // Already blocked by BAD_WEBSITE_DOMAINS but explicitly listed
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  
  // Add more as needed
]);

/**
 * TOS-restrictive domains with reasons
 */
const RESTRICTIVE_TOS = {
  'linkedin.com': 'TOS förbjuder scraping (§8.2)',
  'facebook.com': 'TOS förbjuder automatiserad datainsamling',
  'instagram.com': 'Owned by Meta, strikt scraping-förbud',
  'twitter.com': 'TOS förbjuder crawling utan tillstånd',
  'x.com': 'TOS förbjuder crawling utan tillstånd'
};

/**
 * Check if domain is on Do-Not-Contact list
 * @param {string} host - Hostname
 * @returns {boolean}
 */
export function isDncDomain(host) {
  const normalized = host.toLowerCase();
  
  // Exact match
  if (DNC_LIST.has(normalized)) {
    logger.info('Domain on DNC list', { host });
    return true;
  }
  
  // Suffix match (e.g., subdomain.example.com matches example.com)
  for (const dnc of DNC_LIST) {
    if (normalized.endsWith(`.${dnc}`) || normalized === dnc) {
      logger.info('Domain matches DNC list', { host, dncDomain: dnc });
      return true;
    }
  }
  
  return false;
}

/**
 * Check if domain has restrictive TOS
 * @param {string} host - Hostname
 * @returns {{restricted: boolean, reason?: string}}
 */
export function checkTos(host) {
  const normalized = host.toLowerCase();
  
  for (const [domain, reason] of Object.entries(RESTRICTIVE_TOS)) {
    if (normalized.includes(domain)) {
      return { restricted: true, reason };
    }
  }
  
  return { restricted: false };
}

/**
 * Add domain to DNC list (runtime)
 * @param {string} domain
 */
export function addToDnc(domain) {
  DNC_LIST.add(domain.toLowerCase());
  logger.info('Added to DNC list', { domain });
}

/**
 * Remove domain from DNC list (runtime)
 * @param {string} domain
 */
export function removeFromDnc(domain) {
  DNC_LIST.delete(domain.toLowerCase());
  logger.info('Removed from DNC list', { domain });
}

