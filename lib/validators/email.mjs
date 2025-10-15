import { validate as isValidEmail } from 'email-validator';
import dns from 'dns/promises';
import { logger } from '../logger.mjs';

const ROLE_LOCALPARTS = /^(info|kontakt|support|sales|kundtjanst|office|hej|hello|contact|admin|webmaster|inquiry|service)$/i;
const GENERIC_DOMAINS = /@(gmail|hotmail|outlook|yahoo|live|icloud|protonmail|me\.com|aol|gmx|mail\.com)/i;

const ENABLE_MX_CHECK = process.env.ENABLE_MX_CHECK === 'true';

/**
 * Classify email type
 * @param {string} email - Email address
 * @param {string} siteHost - Website hostname
 * @returns {Promise<{emailType: string, mxValid: boolean}>}
 */
export async function classifyEmail(email, siteHost) {
  const [localpart, domain] = email.split('@');
  
  if (!localpart || !domain) {
    return { emailType: 'unknown', mxValid: false };
  }
  
  // Type classification
  let emailType = 'unknown';
  
  if (ROLE_LOCALPARTS.test(localpart)) {
    emailType = 'role';
  } else if (GENERIC_DOMAINS.test(email)) {
    emailType = 'personal';
  } else if (domain.endsWith(siteHost) || siteHost.endsWith(domain)) {
    // Company domain
    emailType = /^[a-z]{1,2}$|^no-?reply/i.test(localpart) ? 'generic' : 'role';
  } else {
    emailType = 'unknown';
  }
  
  // MX check (optional, can be slow)
  let mxValid = true;
  if (ENABLE_MX_CHECK) {
    try {
      const mx = await dns.resolveMx(domain);
      mxValid = mx.length > 0;
    } catch (err) {
      logger.debug('MX check failed', { email: email.replace(/(.{2}).*(@.*)/, '$1***$2'), error: err.message });
      mxValid = false;
    }
  }
  
  return { emailType, mxValid };
}

/**
 * Score an email (0-100) based on quality indicators
 * @param {string} email - Email address
 * @param {string} emailType - Type classification
 * @param {string} siteHost - Website hostname
 * @returns {number} Score 0-100
 */
export function scoreEmail(email, emailType, siteHost) {
  let score = 50; // Base score
  
  const [localpart, domain] = email.split('@');
  
  // Domain match bonus
  if (domain && (domain.endsWith(siteHost) || siteHost.endsWith(domain))) {
    score += 30;
  }
  
  // Type scoring
  if (emailType === 'role') score += 20;
  if (emailType === 'personal') score -= 10;
  if (emailType === 'generic') score -= 20;
  
  // Preferred localparts
  if (ROLE_LOCALPARTS.test(localpart)) score += 10;
  
  // Penalties
  if (/noreply|no-reply|donotreply/i.test(email)) score -= 50;
  if (/test|example|placeholder/i.test(email)) score -= 50;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Validate email format
 * @param {string} email
 * @returns {boolean}
 */
export function validateEmailFormat(email) {
  return isValidEmail(email);
}

