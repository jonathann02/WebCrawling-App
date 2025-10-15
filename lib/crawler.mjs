import * as cheerio from 'cheerio';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { setTimeout as delay } from 'node:timers/promises';
import { logger } from './logger.mjs';
import { fetchHtml } from './fetcher.mjs';
import { withRateLimit } from './rateLimiter.mjs';
import { isAllowed } from './robots.mjs';
import { isSafeUrl } from './validators/url.mjs';
import { extractContacts } from './extractors/index.mjs';
import { classifyEmail, scoreEmail, validateEmailFormat } from './validators/email.mjs';
import { createContactRecord } from './models/ContactRecord.mjs';
import { getCached, setCached } from './cache.mjs';
import { isDncDomain, checkTos } from './doNotContact.mjs';
import { hasCaptcha, handleCaptcha } from './captcha.mjs';
import { crawlCounter, contactsFound } from './metrics.mjs';

const ALLOWED_TLDS = new Set(['se', 'com', 'info', 'nu', 'org', 'net']);
const BAD_EMAILS = /(example\.com|user@domain\.com|noreply|donotreply|no-reply|test@|placeholder|u003e)/i;
const BETWEEN_REQUESTS_MS = parseInt(process.env.BETWEEN_REQUESTS_MS) || 150;

/**
 * Clean and validate emails
 */
function cleanEmails(emails, siteHost) {
  const out = [];
  const seen = new Set();
  
  for (const item of emails || []) {
    const email = typeof item === 'string' 
      ? item.trim().toLowerCase() 
      : item.email?.trim().toLowerCase();
    
    if (!email || seen.has(email)) continue;
    if (BAD_EMAILS.test(email)) continue;
    if (!validateEmailFormat(email)) continue;
    
    const [localpart, domain] = email.split('@');
    if (!localpart || !domain) continue;
    
    const tld = domain.split('.').pop()?.toLowerCase();
    if (!tld || !ALLOWED_TLDS.has(tld)) continue;
    
    seen.add(email);
    out.push({
      email,
      source: typeof item === 'object' ? item.source : 'unknown',
      confidence: typeof item === 'object' ? item.confidence : 0.5
    });
  }
  
  return out;
}

/**
 * Parse phones from text
 */
function parsePhonesFromText(text) {
  const candidates = new Set((text.replace(/&nbsp;/g, ' ')?.match(/(\+?\d[\d\s().\-]{5,}\d)/g)) || []);
  const normalized = [];
  
  for (let cand of candidates) {
    cand = cand.replace(/[()\s\-.]/g, '');
    if (cand.startsWith('0')) cand = '+46' + cand.slice(1);
    if (!cand.startsWith('+')) continue;
    
    try {
      const p = parsePhoneNumberFromString(cand, 'SE');
      if (p && p.isValid() && p.country === 'SE') {
        const e164 = p.number;
        if (e164.length >= 9 && e164.length <= 15 && !/(\d)\1{6,}/.test(e164)) {
          normalized.push(e164);
        }
      }
    } catch {}
  }
  
  return [...new Set(normalized)];
}

/**
 * Crawl a single URL
 */
async function crawlUrl(url, host, redis = null) {
  try {
    // Check cache first
    const cached = await getCached(url, redis);
    if (cached) {
      logger.debug('Using cached result', { url });
      return cached;
    }
    
    // SSRF check
    const safety = await isSafeUrl(url);
    if (!safety.safe) {
      logger.warn('URL blocked by SSRF protection', { url, reason: safety.reason });
      return null;
    }
    
    // Robots.txt check
    const { allowed, crawlDelay } = await isAllowed(url);
    if (!allowed) {
      logger.info('Blocked by robots.txt', { url });
      crawlCounter.inc({ status: 'robots-blocked', host });
      return null;
    }
    
    // Respect crawl delay
    if (crawlDelay > 0) {
      await delay(Math.max(BETWEEN_REQUESTS_MS, crawlDelay * 1000));
    }
    
    // Fetch with rate limiting
    const html = await withRateLimit(url, () => fetchHtml(url));
    
    // Captcha check
    const captchaResult = handleCaptcha(url, html);
    if (captchaResult.skip) {
      crawlCounter.inc({ status: 'captcha', host });
      return null;
    }
    
    // Parse HTML
    const $ = cheerio.load(html);
    const extracted = extractContacts($, url, host);
    
    // Clean and process emails
    const cleanedEmails = cleanEmails(extracted.emails, host);
    
    // Process phones
    const text = $('body').text();
    const tels = $('a[href^="tel:"]').map((_, a) => $(a).attr('href')?.replace(/^tel:/, '')).get();
    const phones = parsePhonesFromText([tels.join(' '), text].join(' '));
    
    const result = {
      emails: cleanedEmails,
      phones,
      socials: extracted.socials
    };
    
    // Cache result
    await setCached(url, result, redis);
    
    // Update metrics
    if (cleanedEmails.length > 0) contactsFound.inc({ type: 'email' }, cleanedEmails.length);
    if (phones.length > 0) contactsFound.inc({ type: 'phone' }, phones.length);
    
    return result;
  } catch (err) {
    logger.error('crawlUrl failed', { url, host, error: err.message });
    return null;  // Graceful degradation
  }
}

/**
 * Crawl a website (multiple pages)
 */
export async function crawlSite({ rootUrl, host, companyName }, config = {}, redis = null) {
  const maxPages = config.maxPages || 5;
  const results = {
    companyName,
    website: rootUrl,
    domain: host,
    emails: new Map(), // email -> {emailType, confidence, sources}
    phones: new Set(),
    socials: { linkedin: null, facebook: null, x: null },
    sourcePages: new Set(),
    errors: []
  };
  
  // Check DNC list
  if (isDncDomain(host)) {
    logger.info('Skipping DNC domain', { host });
    results.errors.push({ reason: 'Domain on Do-Not-Contact list' });
    return results;
  }
  
  // Check TOS
  const tosCheck = checkTos(host);
  if (tosCheck.restricted) {
    logger.warn('TOS-restricted domain', { host, reason: tosCheck.reason });
    results.errors.push({ reason: tosCheck.reason });
    // Continue anyway but log warning
  }
  
  // Build page list
  const pagesToCrawl = [
    rootUrl,
    `${rootUrl}/kontakt`,
    `${rootUrl}/kontakta-oss`,
    `${rootUrl}/om`,
    `${rootUrl}/om-oss`,
    `${rootUrl}/about`,
    `${rootUrl}/contact`
  ].slice(0, maxPages);
  
  // Crawl each page
  for (const url of pagesToCrawl) {
    try {
      await delay(BETWEEN_REQUESTS_MS);
      
      const pageResult = await crawlUrl(url, host, redis);
      if (!pageResult) continue;
      
      results.sourcePages.add(url);
      
      // Aggregate emails
      for (const emailData of pageResult.emails) {
        const { email, source, confidence } = emailData;
        
        if (!results.emails.has(email)) {
          const { emailType } = await classifyEmail(email, host);
          const score = scoreEmail(email, emailType, host);
          
          results.emails.set(email, {
            email,
            emailType,
            confidence: score / 100,
            sources: [source],
            discoveryPath: source
          });
        } else {
          const existing = results.emails.get(email);
          existing.sources.push(source);
        }
      }
      
      // Aggregate phones
      for (const phone of pageResult.phones) {
        results.phones.add(phone);
      }
      
      // Aggregate socials
      if (pageResult.socials.linkedin) results.socials.linkedin = pageResult.socials.linkedin;
      if (pageResult.socials.facebook) results.socials.facebook = pageResult.socials.facebook;
      if (pageResult.socials.x) results.socials.x = pageResult.socials.x;
      
    } catch (err) {
      logger.error('Failed to crawl page', { url, error: err.message });
      results.errors.push({ url, reason: err.message });
    }
  }
  
  return results;
}

/**
 * Convert crawl result to ContactRecords
 */
export function toContactRecords(crawlResult) {
  const records = [];
  
  for (const [email, data] of crawlResult.emails.entries()) {
    const record = createContactRecord({
      sourceUrl: crawlResult.website,
      domain: crawlResult.domain,
      email,
      emailType: data.emailType,
      confidence: data.confidence,
      discoveryPath: data.discoveryPath,
      phone: [...crawlResult.phones][0] || null,
      contactPage: [...crawlResult.sourcePages].find(p => /kontakt|contact/i.test(p)) || null,
      social: crawlResult.socials,
      rawEvidence: `Sources: ${data.sources.join(', ')}`,
      timestamp: new Date().toISOString()
    });
    
    records.push(record);
  }
  
  return records;
}

