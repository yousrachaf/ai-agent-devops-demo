'use strict';

/**
 * Security and validation middleware.
 *
 * All middleware factories read from env at call time (not module load time) so
 * tests can set env vars before calling createApp() and get fresh configuration.
 */

const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * CORS — accept only the origins listed in CORS_ORIGINS.
 * In development, localhost:3000 is the default; in production the frontend
 * domain must be set explicitly to prevent overly permissive access.
 */
function createCors() {
  const origins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return cors({
    origin: origins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: true,
  });
}

/**
 * Helmet sets secure HTTP response headers (X-Frame-Options, CSP, etc.).
 * Even if the API is consumed only by backend clients, defense-in-depth applies.
 */
function createHelmet() {
  return helmet();
}

/**
 * Rate limiter — 20 requests per minute per IP by default.
 * Each createApp() call gets a fresh MemoryStore, so tests don't share state.
 */
function createRateLimiter() {
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
  const max = parseInt(process.env.RATE_LIMIT_MAX || '20', 10);

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false,
    // Structured error to match the rest of the API error format
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests. Maximum ${max} per ${windowMs / 1000}s window.`,
      },
    },
    handler: (req, res, _next, options) => {
      logger.warn({ ip: req.ip, path: req.path }, 'Rate limit exceeded');
      res.status(429).json(options.message);
    },
  });
}

/**
 * Optional API key authentication.
 * Activated by setting API_KEY_REQUIRED=true in the environment.
 * Clients must send the key in the X-API-Key header.
 *
 * Intentionally kept optional so the demo works out-of-the-box, while showing
 * production deployments can lock down the endpoint easily.
 */
function apiKeyMiddleware(req, res, next) {
  if (process.env.API_KEY_REQUIRED !== 'true') {
    return next();
  }

  const provided = req.headers['x-api-key'];
  const expected = process.env.API_KEY;

  if (!provided || provided !== expected) {
    logger.warn({ ip: req.ip, path: req.path }, 'Unauthorized API key attempt');
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid X-API-Key header' },
    });
  }

  next();
}

/**
 * Input validation for POST /api/ask.
 * Rejects empty, missing, or oversized questions before they reach the agent.
 */
function validateAskInput(req, res, next) {
  const { question } = req.body || {};

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'question is required and must be a non-empty string' },
    });
  }

  if (question.length > 2000) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'question must be 2000 characters or fewer' },
    });
  }

  // Trim before passing to the agent — avoids leading/trailing whitespace issues
  req.body.question = question.trim();
  next();
}

module.exports = {
  createCors,
  createHelmet,
  createRateLimiter,
  apiKeyMiddleware,
  validateAskInput,
};
