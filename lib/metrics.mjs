import { Counter, Histogram, Gauge, register } from 'prom-client';

// Crawl request metrics
export const crawlCounter = new Counter({
  name: 'crawl_requests_total',
  help: 'Total number of crawl requests',
  labelNames: ['status', 'host']
});

// Crawl duration histogram
export const crawlDuration = new Histogram({
  name: 'crawl_duration_seconds',
  help: 'Crawl request duration in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60]
});

// Active jobs gauge
export const activeJobs = new Gauge({
  name: 'crawl_active_jobs',
  help: 'Number of currently active crawl jobs'
});

// Contacts found counter
export const contactsFound = new Counter({
  name: 'contacts_found_total',
  help: 'Total number of contacts found',
  labelNames: ['type'] // email, phone, social
});

// Robots.txt blocks counter
export const robotsBlocked = new Counter({
  name: 'robots_blocked_total',
  help: 'Total number of URLs blocked by robots.txt',
  labelNames: ['host']
});

// Export the registry
export { register };

