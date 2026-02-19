'use strict';

/**
 * API route handlers.
 *
 * Routes are kept thin — they validate, delegate to the agent, and format the
 * response. Business logic lives in src/agent/. This separation makes testing
 * each layer independently straightforward.
 */

const { Router } = require('express');
const { ask, AgentError } = require('../agent/index');
const { MODEL } = require('../agent/claude');
const { apiKeyMiddleware, validateAskInput } = require('./middleware');
const logger = require('../utils/logger');

// ─── In-memory metrics ────────────────────────────────────────────────────────
// Simple counters accumulate for the lifetime of the process.
// In production you'd export these to Prometheus/CloudWatch; this version
// exposes them via GET /metrics for a zero-dependency demo.

const metrics = {
  requests_total: 0,
  errors_total: 0,
  total_latency_ms: 0,
};

// Exposed so tests can reset state between runs
function resetMetrics() {
  metrics.requests_total = 0;
  metrics.errors_total = 0;
  metrics.total_latency_ms = 0;
}

// ─── Router ───────────────────────────────────────────────────────────────────

function createRouter() {
  const router = Router();

  /**
   * POST /api/ask
   * The main agent endpoint. Accepts a question, returns the AI response
   * enriched with tracing metadata (trace_id, latency, token count).
   */
  router.post('/api/ask', apiKeyMiddleware, validateAskInput, async (req, res) => {
    const { question, session_id } = req.body;
    metrics.requests_total++;

    logger.info({ question: question.slice(0, 80), session_id }, 'Incoming /api/ask request');

    try {
      const result = await ask({ question, sessionId: session_id });
      metrics.total_latency_ms += result.latency_ms;

      return res.status(200).json({
        answer: result.answer,
        trace_id: result.trace_id,
        latency_ms: result.latency_ms,
        tokens_used: result.tokens_used,
      });
    } catch (error) {
      metrics.errors_total++;

      if (error instanceof AgentError) {
        // Agent failures are transient (API down, timeout) — 503 signals "retry later"
        logger.error({ error: error.message }, 'AgentError in /api/ask');
        return res.status(503).json({
          error: { code: 'AGENT_UNAVAILABLE', message: 'The AI agent is temporarily unavailable. Please try again.' },
        });
      }

      // Unexpected errors: log with full context for debugging
      logger.error({ error: error.message, stack: error.stack }, 'Unexpected error in /api/ask');
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      });
    }
  });

  /**
   * GET /health
   * Used by Docker HEALTHCHECK, load balancers, and uptime monitors.
   * Returns 200 only when the server is ready to accept traffic.
   */
  router.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      model: MODEL,
      uptime_seconds: Math.floor(process.uptime()),
      version: process.env.npm_package_version || '1.0.0',
    });
  });

  /**
   * GET /metrics
   * Lightweight operational metrics for dashboards and alerting.
   * For production, prefer exporting to Prometheus with prom-client.
   */
  router.get('/metrics', (_req, res) => {
    const avg_latency_ms =
      metrics.requests_total > 0
        ? Math.round(metrics.total_latency_ms / metrics.requests_total)
        : 0;

    res.status(200).json({
      requests_total: metrics.requests_total,
      avg_latency_ms,
      errors_total: metrics.errors_total,
    });
  });

  return router;
}

module.exports = { createRouter, resetMetrics };
