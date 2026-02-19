'use strict';

/**
 * Claude API wrapper with retry, timeout, and structured error handling.
 *
 * Why this wrapper exists instead of calling the SDK directly:
 * - Centralises retry logic so every caller benefits automatically
 * - Normalises the response shape (tokens, cost, latency) for LangFuse tracing
 * - Provides a typed AgentError so callers can distinguish AI failures from bugs
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

// Cost per token for the configured model (USD)
// Source: https://www.anthropic.com/pricing — update when pricing changes
const COST_PER_TOKEN = {
  input: 3.0 / 1_000_000,  // $3 per million input tokens
  output: 15.0 / 1_000_000, // $15 per million output tokens
};

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
const TIMEOUT_MS = parseInt(process.env.ANTHROPIC_TIMEOUT_MS || '30000', 10);
const MAX_RETRIES = 3;

/**
 * Custom error class so callers can catch AI-specific failures separately
 * from validation errors or server bugs.
 */
class AgentError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'AgentError';
    // Preserve the original error for logging without losing context
    if (options.cause) {
      this.cause = options.cause;
      this.statusCode = options.cause.status || null;
    }
  }
}

/**
 * Sleep helper for exponential backoff — keeps retry logic readable.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine if an error from the Claude API is worth retrying.
 * We retry transient errors (rate limits, overload) but not client errors.
 */
function isRetryableError(error) {
  const retryableStatuses = [429, 529]; // rate-limited, overloaded
  const isServerError = error.status >= 500;
  return retryableStatuses.includes(error.status) || isServerError;
}

/**
 * Initialize the Anthropic client once at module load.
 * The SDK reads ANTHROPIC_API_KEY from the environment automatically.
 */
const anthropic = new Anthropic.default({
  timeout: TIMEOUT_MS,
});

/**
 * Call the Claude API with automatic retry on transient failures.
 *
 * @param {string} systemPrompt - The system instructions for the agent
 * @param {string} userMessage  - The user's question
 * @param {string} traceId      - Unique ID for correlating logs and traces
 * @returns {Promise<{text: string, model: string, tokens: {input: number, output: number}, cost_usd: number, latency_ms: number}>}
 * @throws {AgentError} on permanent failure or timeout
 */
async function callClaude(systemPrompt, userMessage, traceId) {
  const startTime = Date.now();
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.debug({ traceId, attempt, model: MODEL }, 'Calling Claude API');

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const latency_ms = Date.now() - startTime;
      const tokens = {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      };
      const cost_usd =
        tokens.input * COST_PER_TOKEN.input +
        tokens.output * COST_PER_TOKEN.output;

      logger.info(
        { traceId, latency_ms, tokens, cost_usd, attempt },
        'Claude API call succeeded'
      );

      return {
        text: response.content[0].text,
        model: response.model,
        tokens,
        cost_usd,
        latency_ms,
      };
    } catch (error) {
      lastError = error;
      const isRetryable = error.status && isRetryableError(error);

      logger.warn(
        { traceId, attempt, error: error.message, status: error.status, isRetryable },
        'Claude API call failed'
      );

      // Don't retry if it's a client error (bad request, auth failure)
      if (!isRetryable || attempt === MAX_RETRIES) {
        break;
      }

      // Exponential backoff: 1s, 2s, 4s — prevents hammering an overloaded API
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
      logger.debug({ traceId, delay, attempt }, 'Retrying after backoff');
      await sleep(delay);
    }
  }

  logger.error(
    { traceId, error: lastError.message, stack: lastError.stack },
    'Claude API permanently failed'
  );

  throw new AgentError('Claude API call failed after retries', { cause: lastError });
}

module.exports = { callClaude, AgentError, MODEL };
