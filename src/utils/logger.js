'use strict';

/**
 * Structured JSON logger using pino.
 *
 * Why pino instead of winston/console.log:
 * - JSON output is parseable by log aggregators (Datadog, CloudWatch, etc.)
 * - ~5x faster than winston because it defers serialization
 * - pino-pretty gives readable output in dev without changing the API
 */

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',

  // In dev, use human-readable output; in prod, raw JSON for log aggregators
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,

  // Standard fields on every log line for correlation in dashboards
  base: {
    service: 'ai-agent-devops-demo',
    version: process.env.npm_package_version || '1.0.0',
    env: process.env.NODE_ENV || 'development',
  },
});

module.exports = logger;
