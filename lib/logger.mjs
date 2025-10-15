import winston from 'winston';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

/**
 * Mask PII (email, phone) in log data
 */
function maskPII(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const masked = { ...obj };
  
  if (masked.email && typeof masked.email === 'string') {
    masked.email = masked.email.replace(/(.{2}).*(@.*)/, '$1***$2');
  }
  
  if (masked.phone && typeof masked.phone === 'string') {
    masked.phone = masked.phone.replace(/(\+\d{2}).*(\d{2})$/, '$1****$2');
  }
  
  if (masked.emails && Array.isArray(masked.emails)) {
    masked.emails = masked.emails.map(e => 
      typeof e === 'string' ? e.replace(/(.{2}).*(@.*)/, '$1***$2') : e
    );
  }
  
  if (masked.phones && Array.isArray(masked.phones)) {
    masked.phones = masked.phones.map(p => 
      typeof p === 'string' ? p.replace(/(\+\d{2}).*(\d{2})$/, '$1****$2') : p
    );
  }
  
  return masked;
}

const customFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    const maskedMeta = maskPII(meta);
    const metaStr = Object.keys(maskedMeta).length ? JSON.stringify(maskedMeta) : '';
    return `${timestamp} [${level.toUpperCase()}] ${message} ${metaStr}`;
  })
);

export const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: customFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        customFormat
      )
    }),
    new winston.transports.File({ 
      filename: 'error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: 'combined.log',
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

// Export maskPII for testing
export { maskPII };

