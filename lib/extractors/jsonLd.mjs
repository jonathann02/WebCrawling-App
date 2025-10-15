import { logger } from '../logger.mjs';

/**
 * Extract contact information from JSON-LD structured data
 * @param {CheerioAPI} $ - Cheerio instance
 * @returns {Object} Extracted contacts
 */
export function extractJsonLd($) {
  const scripts = $('script[type="application/ld+json"]').toArray();
  const contacts = { 
    emails: [], 
    phones: [], 
    socials: {
      linkedin: null,
      facebook: null,
      x: null
    }
  };
  
  for (const script of scripts) {
    try {
      const jsonText = $(script).html();
      if (!jsonText) continue;
      
      const data = JSON.parse(jsonText);
      const items = Array.isArray(data) ? data : [data];
      
      for (const item of items) {
        if (!item || !item['@type']) continue;
        
        // Handle Organization, LocalBusiness, Corporation, etc.
        const validTypes = ['Organization', 'LocalBusiness', 'Corporation', 'Store', 'ProfessionalService'];
        if (validTypes.includes(item['@type'])) {
          // Direct email
          if (item.email) {
            contacts.emails.push({ 
              email: item.email, 
              source: 'json-ld', 
              confidence: 0.95,
              context: item['@type']
            });
          }
          
          // Direct telephone
          if (item.telephone) {
            contacts.phones.push(item.telephone);
          }
          
          // Social profiles (sameAs)
          if (item.sameAs) {
            const urls = Array.isArray(item.sameAs) ? item.sameAs : [item.sameAs];
            for (const url of urls) {
              if (typeof url !== 'string') continue;
              
              if (url.includes('linkedin.com')) {
                contacts.socials.linkedin = url;
              } else if (url.includes('facebook.com')) {
                contacts.socials.facebook = url;
              } else if (url.includes('twitter.com') || url.includes('x.com')) {
                contacts.socials.x = url;
              }
            }
          }
          
          // ContactPoint
          if (item.contactPoint) {
            const points = Array.isArray(item.contactPoint) ? item.contactPoint : [item.contactPoint];
            for (const point of points) {
              if (point.email) {
                contacts.emails.push({ 
                  email: point.email, 
                  source: 'json-ld-contactpoint', 
                  confidence: 0.95,
                  contactType: point.contactType || 'general'
                });
              }
              if (point.telephone) {
                contacts.phones.push(point.telephone);
              }
            }
          }
        }
      }
    } catch (err) {
      // Invalid JSON-LD, skip silently
      logger.debug('Failed to parse JSON-LD', { error: err.message });
    }
  }
  
  return contacts;
}

