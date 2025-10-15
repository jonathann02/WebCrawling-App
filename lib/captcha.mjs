import { logger } from './logger.mjs';

/**
 * Detect if HTML contains captcha/challenge
 * @param {string} html - HTML content
 * @returns {boolean}
 */
export function hasCaptcha(html) {
  const indicators = [
    /recaptcha/i,
    /hcaptcha/i,
    /cloudflare/i,
    /cf-browser-verification/i,
    /just a moment/i,
    /attention required/i,
    /challenge-platform/i,
    /g-recaptcha/i,
    /grecaptcha/i
  ];
  
  return indicators.some(pattern => pattern.test(html));
}

/**
 * Get captcha type if detected
 * @param {string} html
 * @returns {string|null} - 'recaptcha', 'hcaptcha', 'cloudflare', or null
 */
export function getCaptchaType(html) {
  if (/g-recaptcha|grecaptcha|recaptcha/i.test(html)) {
    return 'recaptcha';
  }
  if (/hcaptcha/i.test(html)) {
    return 'hcaptcha';
  }
  if (/cloudflare|cf-browser-verification|challenge-platform/i.test(html)) {
    return 'cloudflare';
  }
  return null;
}

/**
 * Handle captcha detection (log and skip strategy)
 * @param {string} url
 * @param {string} html
 * @returns {{skip: boolean, reason: string}}
 */
export function handleCaptcha(url, html) {
  const captchaType = getCaptchaType(html);
  
  if (captchaType) {
    logger.warn('Captcha detected, skipping', { url, captchaType });
    return {
      skip: true,
      reason: `Captcha detected (${captchaType})`
    };
  }
  
  return { skip: false };
}

