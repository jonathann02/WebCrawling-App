import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify as toCsv } from 'csv-stringify/sync';
import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { logger } from './lib/logger.mjs';
import { register as metricsRegister } from './lib/metrics.mjs';
import { validateConcurrency, validateMaxPages, sanitizeTags } from './lib/validators/url.mjs';

// Auto-create .env from .env.example if missing
const envPath = path.join(process.cwd(), '.env');
const envExample = path.join(process.cwd(), '.env.example');

if (!fs.existsSync(envPath) && fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, envPath);
  logger.info('.env file created from .env.example');
}

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Redis connection
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
let redisConnection;
let crawlQueue;

try {
  redisConnection = new Redis(REDIS_URL, { 
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true
  });
  
  await redisConnection.connect();
  logger.info('Redis connected', { url: REDIS_URL });
  
  // Only create queue if Redis is actually connected
  if (redisConnection.status === 'ready') {
    crawlQueue = new Queue('crawl-jobs', { connection: redisConnection });
    logger.info('Queue initialized');
  } else {
    logger.warn('Redis connected but not ready, queue not initialized');
  }
} catch (err) {
  logger.error('Failed to connect to Redis', { error: err.message });
  logger.warn('Running in degraded mode (no queue support)');
  redisConnection = null;  // Ensure it's null on failure
}

app.use(express.static('public'));
app.use(express.json());

// Health check
app.get('/health', (_, res) => {
  res.json({ 
    ok: true, 
    redis: redisConnection?.status === 'ready',
    queue: !!crawlQueue
  });
});

// Metrics endpoint
app.get('/metrics', async (_, res) => {
  try {
    res.set('Content-Type', metricsRegister.contentType);
    res.end(await metricsRegister.metrics());
  } catch (err) {
    logger.error('Metrics error', { error: err.message });
    res.status(500).end();
  }
});

// Example CSV download
app.get('/example.csv', (_, res) => {
  const example = `title,website,phone
Söderlinds EL AB,http://www.soderlindsel.se/,+46 8 400 222 70
Phoenix Elteknik,https://www.phxel.se/,+46 10 551 58 58
Bright Elteknik AB,http://www.brightel.se/,+46 8 520 250 00`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="example.csv"');
  res.send(example);
});

// Helper: normalize website URL
function normalizeWebsite(website, debug = false) {
  if (!website) {
    if (debug) logger.debug('normalizeWebsite: empty input');
    return null;
  }
  
  let url = String(website).trim();
  if (!url) {
    if (debug) logger.debug('normalizeWebsite: empty after trim');
    return null;
  }
  
  // Remove quotes (both single and double) that may come from CSV
  url = url.replace(/^["']|["']$/g, '');
  url = url.trim();
  if (!url) {
    if (debug) logger.debug('normalizeWebsite: empty after quote removal');
    return null;
  }
  
  // Add protocol if missing
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  
  try {
    const u = new URL(url);
    
    // Filter out social media and directory sites
    const BAD_DOMAINS = /(facebook|instagram|linkedin|bokadirekt|reco|hitta|eniro|allabolag|yelp|maps\.google)\./i;
    if (BAD_DOMAINS.test(u.hostname)) {
      if (debug) logger.debug('normalizeWebsite: blocked domain', { hostname: u.hostname });
      return null;
    }
    
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const result = { rootUrl: `${u.protocol}//${host}`, host };
    
    if (debug) logger.debug('normalizeWebsite: success', { input: website, result });
    return result;
  } catch (err) {
    if (debug) logger.debug('normalizeWebsite: URL parse failed', { input: website, url, error: err.message });
    return null;
  }
}

// Helper: find column
function pickColumn(row, candidates) {
  const normalizeHeader = (h) => String(h || '').toLowerCase().replace(/\s+/g, ' ').trim();
  
  for (const key of Object.keys(row)) {
    const nk = normalizeHeader(key);
    for (const c of candidates) {
      if (c instanceof RegExp ? c.test(nk) : nk.includes(c)) return key;
    }
  }
  return null;
}

// POST /api/enrich - Create crawl job
app.post('/api/enrich', upload.single('file'), async (req, res) => {
  try {
    if (!crawlQueue) {
      return res.status(503).json({ 
        error: 'Tjänsten är inte tillgänglig (Redis-anslutning saknas)' 
      });
    }
    
    // Validate inputs
    const { concurrency, maxPagesPerSite, tags } = req.body;
    const concValidation = validateConcurrency(concurrency);
    const maxPagesValidation = validateMaxPages(maxPagesPerSite);
    const sanitizedTags = sanitizeTags(tags);
    
    if (!concValidation.valid || !maxPagesValidation.valid) {
      return res.status(400).json({
        error: 'Ogiltiga inställningar',
        details: {
          concurrency: concValidation.message,
          maxPages: maxPagesValidation.message
        }
      });
    }
    
    // Parse CSV
    let raw = req.file?.buffer?.toString('utf8') ?? '';
    if (!raw) {
      return res.status(400).json({ error: 'Ingen fil mottagen.' });
    }

    // Fix corrupted Apify CSV format where entire rows are wrapped in quotes
    // Corrupted format: "title,""value""...";;;;;;; 
    // Correct format: "title","value",...
    const lines = raw.split('\n');
    const cleanedLines = lines.map((line, index) => {
      if (!line.trim()) return line; // Skip empty lines
      
      const originalLine = line;
      
      // Remove trailing semicolons (corrupted format has these)
      line = line.trimEnd().replace(/;+$/g, '');
      
      // Detect corrupted format:
      // 1. Entire line wrapped in ONE pair of quotes
      // 2. Contains escaped quotes ("") inside
      // 3. Does NOT contain "," pattern (which indicates proper CSV fields)
      const isCorrupted = 
        line.startsWith('"') && 
        line.endsWith('"') && 
        line.includes('""') && 
        !line.includes('","');
      
      if (isCorrupted) {
        // Remove outer quotes and unescape doubled quotes
        let unwrapped = line.slice(1, -1).replace(/""/g, '"');
        
        if (index < 3) {
          logger.debug('CSV line cleaned (corrupted format)', { 
            line: index,
            original: originalLine.substring(0, 80),
            cleaned: unwrapped.substring(0, 80)
          });
        }
        
        return unwrapped;
      }
      
      // Return line as-is (possibly with trailing semicolons removed)
      if (index < 3 && originalLine !== line) {
        logger.debug('CSV line cleaned (removed trailing ;)', { 
          line: index,
          original: originalLine.substring(0, 80),
          cleaned: line.substring(0, 80)
        });
      }
      
      return line;
    });
    
    raw = cleanedLines.join('\n');
    
    logger.info('CSV file processed', { 
      totalLines: lines.length,
      firstLineOriginal: lines[0]?.substring(0, 80),
      firstLineCleaned: cleanedLines[0]?.substring(0, 80)
    });

    const records = parseCsv(raw, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      delimiter: ',',
      relax_column_count: true,
      skip_records_with_empty_values: false
    });

    if (!records.length) {
      return res.status(400).json({ error: 'CSV: inga rader.' });
    }

    // Find columns
    const first = records[0];
    const websiteCol = pickColumn(first, ['website', 'webb', 'hemsida', 'url', 'site', 'domän', 'domain', 'www', 'web', 'link']);
    const companyCol = pickColumn(first, ['företag', 'company', 'bolag', 'organisation', 'org', 'brand', 'name', 'namn', 'title', 'företagsnamn']);
    
    logger.debug('CSV columns detected', { 
      websiteCol, 
      companyCol, 
      availableColumns: Object.keys(first),
      sampleRow: first 
    });
    
    if (!websiteCol) {
      return res.status(400).json({ 
        error: 'Kunde inte hitta kolumn för webbplats',
        hint: 'CSV måste ha en kolumn som heter "website", "url", "hemsida" eller liknande.' 
      });
    }
    
    // Extract sites
    const sites = [];
    const errors = [];
    
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const rawWebsite = r[websiteCol];
      // Debug first 3 rows to see what's happening
      const debugThis = i < 3;
      const n = normalizeWebsite(rawWebsite, debugThis);
      
      if (n) {
        sites.push({ 
          ...n, 
          companyName: companyCol ? String(r[companyCol] || '').trim() : '' 
        });
      } else {
        errors.push({
          row: i + 2, // +1 for header, +1 for 1-indexing
          website: rawWebsite,
          reason: 'Ogiltig URL eller blockerad domän'
        });
      }
    }
    
    logger.info('CSV parsing complete', { 
      totalRows: records.length, 
      sitesExtracted: sites.length, 
      errors: errors.length,
      sampleSite: sites[0],
      sampleError: errors[0]
    });
    
    // Deduplicate by host
    const byHost = new Map();
    for (const s of sites) {
      byHost.set(s.host, s);
    }
    const uniqueSites = [...byHost.values()];

    if (uniqueSites.length === 0) {
      return res.status(400).json({ 
        error: 'Inga giltiga webbplatser hittades i CSV:n',
        errors 
      });
    }
    
    // Create job
    const jobId = crypto.randomUUID();
    
    await crawlQueue.add('batch-crawl', {
      jobId,
      sites: uniqueSites,
      config: {
        concurrency: concValidation.value,
        maxPages: maxPagesValidation.value,
        tags: sanitizedTags,
        user: 'anonymous' // TODO: Add auth
      }
    }, {
      jobId,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: {
        age: 3600 * 24 // Keep completed jobs for 24h
      },
      removeOnFail: {
        age: 3600 * 24 * 7 // Keep failed jobs for 7 days
      }
    });
    
    logger.info('Job created', { jobId, sites: uniqueSites.length });
    
    res.json({
      jobId,
      status: 'queued',
      sites: uniqueSites.length,
      estimatedDuration: uniqueSites.length * 2, // ~2 seconds per site
      errors: errors.length > 0 ? errors : undefined
    });
    
  } catch (err) {
    logger.error('Enrich error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Något gick fel i bearbetningen.' });
  }
});

// GET /api/jobs/:id - Get job status
app.get('/api/jobs/:id', async (req, res) => {
  try {
    if (!crawlQueue) {
      return res.status(503).json({ error: 'Tjänsten är inte tillgänglig' });
    }
    
    const job = await crawlQueue.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Jobb ej funnet' });
    }
    
    const state = await job.getState();
    const progress = job.progress || { percentage: 0 };
    
    res.json({
      jobId: job.id,
      state,
      progress: progress.percentage || 0,
      current: progress.current,
      stats: {
        processed: progress.processed || 0,
        total: progress.total || 0,
        found: progress.found || 0
      },
      result: state === 'completed' ? job.returnvalue : undefined
    });
    
  } catch (err) {
    logger.error('Job status error', { error: err.message });
    res.status(500).json({ error: 'Något gick fel' });
  }
});

// GET /api/jobs/:id/progress - SSE for real-time updates
app.get('/api/jobs/:id/progress', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const jobId = req.params.id;
  
  const sendUpdate = async () => {
    try {
      if (!crawlQueue) {
        res.write('event: error\ndata: {"error": "Service unavailable"}\n\n');
        return false;
      }
      
      const job = await crawlQueue.getJob(jobId);
      if (!job) {
        res.write('event: error\ndata: {"error": "Job not found"}\n\n');
        return false;
      }
      
      const state = await job.getState();
      const progress = job.progress || { percentage: 0 };
      
      const data = {
        state,
        progress: progress.percentage || 0,
        current: progress.current,
        stats: {
          processed: progress.processed || 0,
          total: progress.total || 0,
          found: progress.found || 0
        }
      };
      
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      
      return state === 'completed' || state === 'failed';
    } catch (err) {
      logger.error('SSE error', { error: err.message });
      res.write('event: error\ndata: {"error": "Internal error"}\n\n');
      return false;
    }
  };
  
  const interval = setInterval(async () => {
    const done = await sendUpdate();
    if (done) {
      clearInterval(interval);
      res.end();
    }
  }, 1000);
  
  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

// GET /api/jobs/:id/export - Export results as CSV
app.get('/api/jobs/:id/export', async (req, res) => {
  try {
    if (!crawlQueue) {
      return res.status(503).json({ error: 'Tjänsten är inte tillgänglig' });
    }
    
    const job = await crawlQueue.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Jobb ej funnet' });
    }
    
    const state = await job.getState();
    if (state !== 'completed') {
      return res.status(400).json({ error: 'Jobbet är inte klart än' });
    }
    
    const { records } = job.returnvalue;
    const format = req.query.format || 'enriched';
    
    // Filter records for high quality export
    let exportRecords = records;
    if (format === 'highquality') {
      exportRecords = records.filter(r => r.confidence >= 0.8);
    }
    
    if (format === 'mailchimp') {
      // Mailchimp format
      const rows = exportRecords.map(r => ({
        'Email Address': r.email,
        'First Name': '',
        'Last Name': '',
        'Company': r.domain,
        'Phone Number': r.phone || '',
        'Website': r.sourceUrl,
        'Tags': job.data.config.tags || ''
      }));
      
      const csv = toCsv(rows, { header: true });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="mailchimp.csv"');
      res.send(csv);
      
    } else {
      // Enriched format (or high quality)
      const rows = exportRecords.map(r => ({
        'Email': r.email,
        'Email Type': r.emailType,
        'Confidence': Math.round(r.confidence * 100) + '%',
        'Domain': r.domain,
        'Phone': r.phone || '',
        'Discovery Path': r.discoveryPath,
        'Contact Page': r.contactPage || '',
        'LinkedIn': r.social?.linkedin || '',
        'Facebook': r.social?.facebook || '',
        'Twitter/X': r.social?.x || '',
        'Source URL': r.sourceUrl,
        'Timestamp': r.timestamp
      }));
      
      const csv = toCsv(rows, { header: true });
      const filename = format === 'highquality' ? 'high-quality.csv' : 'enriched.csv';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    }
    
  } catch (err) {
    logger.error('Export error', { error: err.message });
    res.status(500).json({ error: 'Något gick fel' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing...');
  if (crawlQueue) await crawlQueue.close();
  if (redisConnection) await redisConnection.quit();
  process.exit(0);
});
