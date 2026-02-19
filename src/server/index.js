'use strict';

/**
 * Express application factory and server entry point.
 *
 * The app creation is split from the server startup (listen) so tests can
 * import createApp() and use supertest without actually binding to a port.
 * This pattern also makes it easy to run multiple test suites in parallel.
 */

require('dotenv').config();
const express = require('express');
const { createCors, createHelmet, createRateLimiter } = require('./middleware');
const { createRouter } = require('./routes');
const { shutdownTracing } = require('../agent/tracing');
const logger = require('../utils/logger');

const PORT = parseInt(process.env.PORT || '3000', 10);

/**
 * Create and configure the Express application.
 * Called once at startup and once per test file for isolation.
 *
 * @returns {import('express').Application}
 */
function createApp() {
  const app = express();

  // ── Global middleware ────────────────────────────────────────────────────
  app.use(createHelmet());
  app.use(createCors());
  app.use(createRateLimiter());
  app.use(express.json({ limit: '50kb' })); // Reject oversized bodies early

  // ── Routes ───────────────────────────────────────────────────────────────
  app.use('/', createRouter());

  // ── 404 catch-all ────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  // ── Global error handler ─────────────────────────────────────────────────
  // Express requires a 4-argument function signature to treat it as an error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    logger.error({ error: err.message, path: req.path }, 'Unhandled Express error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  return app;
}

/**
 * Start the HTTP server.
 * Registers SIGTERM/SIGINT handlers for graceful shutdown — important for
 * Docker containers and Kubernetes pods which send SIGTERM before killing.
 */
function startServer() {
  const app = createApp();
  const server = app.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV }, 'Server started');
  });

  // Graceful shutdown — flush LangFuse traces before the process exits
  async function shutdown(signal) {
    logger.info({ signal }, 'Shutdown signal received');
    server.close(async () => {
      await shutdownTracing();
      logger.info('Server closed cleanly');
      process.exit(0);
    });

    // Force exit after 10s if connections don't drain
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

// Only bind to a port when this file is run directly (not required by tests)
if (require.main === module) {
  startServer();
}

module.exports = { createApp };
