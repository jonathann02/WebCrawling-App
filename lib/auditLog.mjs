import fs from 'fs/promises';
import { logger } from './logger.mjs';

const AUDIT_LOG_FILE = 'audit.jsonl';

/**
 * Log a crawl operation for audit purposes
 * @param {Object} data - Audit log data
 * @returns {Promise<void>}
 */
export async function logCrawl({
  jobId,
  host,
  recordsFound,
  user = 'anonymous',
  action = 'crawl'
}) {
  const entry = {
    timestamp: new Date().toISOString(),
    jobId,
    host,
    recordsFound,
    user,
    action
  };
  
  try {
    await fs.appendFile(AUDIT_LOG_FILE, JSON.stringify(entry) + '\n');
    logger.debug('Audit log written', { jobId, host, recordsFound });
  } catch (err) {
    logger.error('Failed to write audit log', { error: err.message, entry });
  }
}

/**
 * Read audit logs (for compliance reports)
 * @param {number} limit - Max number of entries to read
 * @returns {Promise<Array>}
 */
export async function readAuditLogs(limit = 100) {
  try {
    const content = await fs.readFile(AUDIT_LOG_FILE, 'utf-8');
    const lines = content.trim().split('\n').slice(-limit);
    return lines.map(line => JSON.parse(line));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return []; // File doesn't exist yet
    }
    logger.error('Failed to read audit log', { error: err.message });
    throw err;
  }
}

