import { extractJsonLd } from './jsonLd.mjs';
import { logger } from '../logger.mjs';

const KEY_PAGES = /(kontakt|kontakta|about|om|team|medarbetare|personal|ledning|contact)/i;

/**
 * Extract all contact information from a page
 * @param {CheerioAPI} $ - Cheerio instance
 * @param {string} url - Page URL
 * @param {string} host - Website hostname
 * @returns {Object} Extracted contacts with sources and confidence
 */
export function extractContacts($, url, host) {
  const allSources = [];
  const pathname = new URL(url).pathname.toLowerCase();
  const isContactPage = KEY_PAGES.test(pathname);
  
  // 1. JSON-LD (highest priority)
  const jsonLd = extractJsonLd($);
  allSources.push(...jsonLd.emails);
  
  // 2. Mailto links
  const mailtos = $('a[href^="mailto:"]')
    .map((_, a) => {
      const href = $(a).attr('href') || '';
      const email = href.replace(/^mailto:/i, '').split('?')[0].trim();
      return {
        email,
        source: 'mailto',
        confidence: 0.85
      };
    })
    .get();
  allSources.push(...mailtos);
  
  // 3. Inline emails from text
  const text = $('body').text();
  const emailMatches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi) || [];
  const inlineEmails = emailMatches.map(email => ({
    email: email.trim(),
    source: 'inline',
    confidence: isContactPage ? 0.70 : 0.50
  }));
  allSources.push(...inlineEmails);
  
  // 4. Footer emails
  const footerEmails = $('footer a[href^="mailto:"]')
    .map((_, a) => {
      const href = $(a).attr('href') || '';
      const email = href.replace(/^mailto:/i, '').split('?')[0].trim();
      return {
        email,
        source: 'footer',
        confidence: 0.60
      };
    })
    .get();
  allSources.push(...footerEmails);
  
  return {
    emails: allSources,
    phones: jsonLd.phones,
    socials: jsonLd.socials
  };
}

/**
 * Extract contact page links
 * @param {CheerioAPI} $ - Cheerio instance
 * @param {string} baseUrl - Base URL
 * @returns {Array<string>} Contact page URLs
 */
export function findContactPages($, baseUrl) {
  const links = [];
  const base = new URL(baseUrl);
  
  $('a[href]').each((_, elem) => {
    const href = $(elem).attr('href');
    if (!href) return;
    
    try {
      const url = new URL(href, baseUrl);
      
      // Same domain only
      if (url.hostname !== base.hostname) return;
      
      const pathname = url.pathname.toLowerCase();
      const linkText = $(elem).text().toLowerCase();
      
      // Match contact-related paths or text
      if (KEY_PAGES.test(pathname) || KEY_PAGES.test(linkText)) {
        links.push(url.href);
      }
    } catch {
      // Invalid URL, skip
    }
  });
  
  return [...new Set(links)].slice(0, 5); // Max 5 contact pages
}

