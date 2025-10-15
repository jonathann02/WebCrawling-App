import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv();
addFormats(ajv);

/**
 * ContactRecord JSON Schema (as per specification)
 */
const contactRecordSchema = {
  type: 'object',
  required: ['sourceUrl', 'domain', 'email', 'emailType', 'confidence', 'discoveryPath'],
  properties: {
    sourceUrl: { type: 'string', format: 'uri' },
    domain: { type: 'string' },
    email: { type: 'string' },
    emailType: { type: 'string', enum: ['role', 'personal', 'generic', 'unknown'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    discoveryPath: { type: 'string' },
    phone: { type: ['string', 'null'] },
    contactPage: { type: ['string', 'null'], format: 'uri' },
    social: {
      type: 'object',
      properties: {
        linkedin: { type: ['string', 'null'] },
        facebook: { type: ['string', 'null'] },
        x: { type: ['string', 'null'] }
      }
    },
    rawEvidence: { type: ['string', 'null'] },
    timestamp: { type: 'string', format: 'date-time' }
  }
};

export const validateContactRecord = ajv.compile(contactRecordSchema);

/**
 * Create a ContactRecord
 * @param {Object} data - Contact data
 * @returns {Object} ContactRecord
 */
export function createContactRecord({
  sourceUrl,
  domain,
  email,
  emailType,
  confidence,
  discoveryPath,
  phone = null,
  contactPage = null,
  social = {},
  rawEvidence = null,
  timestamp = new Date().toISOString()
}) {
  return {
    sourceUrl,
    domain,
    email,
    emailType,
    confidence,
    discoveryPath,
    phone,
    contactPage,
    social: {
      linkedin: social.linkedin || null,
      facebook: social.facebook || null,
      x: social.x || null
    },
    rawEvidence,
    timestamp
  };
}

/**
 * Validate and create ContactRecord
 * @param {Object} data
 * @returns {{valid: boolean, record?: Object, errors?: Array}}
 */
export function createValidatedContactRecord(data) {
  const record = createContactRecord(data);
  const valid = validateContactRecord(record);
  
  if (!valid) {
    return {
      valid: false,
      errors: validateContactRecord.errors
    };
  }
  
  return {
    valid: true,
    record
  };
}

