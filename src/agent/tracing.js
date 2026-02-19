'use strict';

/**
 * LangFuse tracing integration.
 *
 * Why trace every AI call:
 * - Token costs can spiral silently without observability
 * - LangFuse lets you replay exact prompts when debugging quality issues
 * - Quality scoring (set later via the dashboard or /metrics endpoint) closes
 *   the feedback loop between engineering and business outcomes
 */

require('dotenv').config();
const { Langfuse } = require('langfuse');
const logger = require('../utils/logger');

const LANGFUSE_ENABLED = process.env.LANGFUSE_ENABLED !== 'false';

// Initialise once — the client is thread-safe and batches events internally
let langfuseClient = null;

function getLangfuseClient() {
  if (!LANGFUSE_ENABLED) return null;

  if (!langfuseClient) {
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    const baseUrl = process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com';

    if (!publicKey || !secretKey) {
      logger.warn(
        'LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not set — tracing disabled'
      );
      return null;
    }

    langfuseClient = new Langfuse({
      publicKey,
      secretKey,
      baseUrl,
      // Flush events within 2s — balances latency vs batching efficiency
      flushAt: 10,
      flushInterval: 2000,
    });

    logger.info({ baseUrl }, 'LangFuse tracing initialised');
  }

  return langfuseClient;
}

/**
 * Record a complete agent interaction in LangFuse.
 *
 * This is called after the Claude API responds so the trace always has both
 * input and output — partial traces are noise in the dashboard.
 *
 * @param {object} params
 * @param {string} params.traceId           - UUID for this interaction
 * @param {string} params.sessionId         - Optional session grouping
 * @param {string} params.input             - Original user question
 * @param {string} params.output            - Agent's answer
 * @param {string} params.model             - Model name (from Claude response)
 * @param {object} params.tokens            - { input: number, output: number }
 * @param {number} params.cost_usd          - Calculated cost in USD
 * @param {number} params.latency_ms        - End-to-end latency
 * @param {string[]} params.knowledgeChunks - Knowledge base sections used
 * @param {string} params.systemPrompt      - The system prompt sent to Claude
 */
async function recordTrace({
  traceId,
  sessionId,
  input,
  output,
  model,
  tokens,
  cost_usd,
  latency_ms,
  knowledgeChunks,
  systemPrompt,
}) {
  const client = getLangfuseClient();
  if (!client) return;

  try {
    // A "trace" groups all LLM calls for one user interaction
    const trace = client.trace({
      id: traceId,
      name: 'agent-query',
      input: { question: input },
      output: { answer: output },
      sessionId: sessionId || undefined,
      metadata: {
        knowledge_chunks_used: knowledgeChunks,
        cost_usd,
        latency_ms,
      },
    });

    // A "generation" represents one LLM call within a trace
    // LangFuse uses this to compute token dashboards and cost aggregations
    trace.generation({
      name: 'claude-completion',
      model,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ],
      output: output,
      usage: {
        input: tokens.input,
        output: tokens.output,
        unit: 'TOKENS',
      },
      metadata: { cost_usd, latency_ms },
    });

    // Flush is async — we don't await here to avoid adding latency to the
    // HTTP response. Events are queued and sent in the background.
    client.flushAsync().catch((err) => {
      logger.warn({ error: err.message }, 'LangFuse flush failed');
    });

    logger.debug({ traceId, cost_usd, latency_ms }, 'LangFuse trace recorded');
  } catch (error) {
    // Tracing failure must never break the agent response — log and continue
    logger.error({ traceId, error: error.message }, 'LangFuse recording failed');
  }
}

/**
 * Gracefully flush all pending events before process exit.
 * Call this in your SIGTERM handler to avoid losing the last traces.
 */
async function shutdownTracing() {
  if (langfuseClient) {
    await langfuseClient.shutdownAsync();
    logger.info('LangFuse shutdown complete');
  }
}

module.exports = { recordTrace, shutdownTracing, getLangfuseClient };
