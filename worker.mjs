import 'dotenv/config';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { crawlSite, toContactRecords } from './lib/crawler.mjs';
import { logger } from './lib/logger.mjs';
import { activeJobs } from './lib/metrics.mjs';
import { logCrawl } from './lib/auditLog.mjs';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new Redis(REDIS_URL, { 
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    if (times > 10) {
      logger.error('Max Redis connection retries reached (10), exiting worker');
      process.exit(1);
    }
    const delay = Math.min(times * 1000, 30000);
    logger.debug(`Redis retry attempt ${times}, waiting ${delay}ms`);
    return delay;
  }
});

logger.info('Worker starting...', { redisUrl: REDIS_URL });

const worker = new Worker('crawl-jobs', async (job) => {
  const { jobId, sites, config } = job.data;
  logger.info('Job started', { jobId, sitesCount: sites.length });
  
  activeJobs.inc();
  
  const allRecords = [];
  const errors = [];
  
  try {
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      
      try {
        // Update progress
        await job.updateProgress({
          percentage: (i / sites.length) * 100,
          current: site.host,
          processed: i,
          total: sites.length,
          found: allRecords.length
        });
        
        await job.log(`Processing ${site.host}...`);
        
        // Crawl site
        const result = await crawlSite(site, config, connection);
        
        // Convert to ContactRecords
        const records = toContactRecords(result);
        allRecords.push(...records);
        
        // Audit log
        await logCrawl({
          jobId,
          host: site.host,
          recordsFound: records.length,
          user: config.user || 'anonymous'
        });
        
        // Track errors
        if (result.errors.length > 0) {
          errors.push({
            host: site.host,
            errors: result.errors
          });
        }
        
        logger.info('Site processed', { 
          host: site.host, 
          records: records.length,
          emails: result.emails.size,
          phones: result.phones.size
        });
        
      } catch (err) {
        logger.error('Failed to process site', { host: site.host, error: err.message });
        errors.push({
          host: site.host,
          errors: [{ reason: err.message }]
        });
      }
    }
    
    // Final progress
    await job.updateProgress({
      percentage: 100,
      current: null,
      processed: sites.length,
      total: sites.length,
      found: allRecords.length
    });
    
    logger.info('Job completed', { 
      jobId, 
      totalRecords: allRecords.length,
      totalErrors: errors.length
    });
    
    return {
      records: allRecords,
      errors,
      stats: {
        totalSites: sites.length,
        totalRecords: allRecords.length,
        totalErrors: errors.length,
        avgRecordsPerSite: allRecords.length / sites.length
      }
    };
    
  } finally {
    activeJobs.dec();
  }
}, {
  connection,
  concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 2,
  limiter: {
    max: 10,
    duration: 1000
  }
});

worker.on('completed', (job) => {
  logger.info('Worker job completed', { jobId: job.id });
});

worker.on('failed', (job, err) => {
  logger.error('Worker job failed', { jobId: job?.id, error: err.message });
});

worker.on('error', (err) => {
  logger.error('Worker error', { error: err.message });
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing worker...');
  await worker.close();
  await connection.quit();
  process.exit(0);
});

logger.info('Worker ready');

