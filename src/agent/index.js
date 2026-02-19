'use strict';

/**
 * Agent orchestrator — the single entry point for all AI interactions.
 *
 * Execution flow for each query:
 *   1. Retrieve relevant knowledge chunks (RAG pattern)
 *   2. Build a focused system prompt with the retrieved context
 *   3. Call Claude with retry/timeout handling
 *   4. Record the full trace in LangFuse
 *   5. Return a structured response with metadata
 *
 * The orchestrator owns the "shape" of the response — callers (HTTP routes,
 * tests) always receive the same structure regardless of what changed internally.
 */

const { v4: uuidv4 } = require('uuid');
const { callClaude, AgentError } = require('./claude');
const { findRelevantChunks } = require('./knowledge');
const { recordTrace } = require('./tracing');
const logger = require('../utils/logger');

// The system prompt defines the agent's persona and constraints.
// Keeping it here (not in the knowledge base) makes it easy to A/B test.
const SYSTEM_PROMPT_TEMPLATE = (contextChunks) => `You are a helpful support agent for TechCorp API.
You answer developer questions based strictly on the provided documentation.

DOCUMENTATION CONTEXT:
${contextChunks.map((c) => c.content).join('\n\n---\n\n')}

INSTRUCTIONS:
- Answer only questions related to TechCorp API
- If the answer is not in the documentation, say so clearly — do not invent information
- Keep answers concise and developer-friendly
- Include relevant code examples when helpful
- Cite the documentation section you used (e.g., "According to the Authentication section...")
- If asked in French, respond in French; otherwise respond in English`;

/**
 * Process a user question through the full agent pipeline.
 *
 * @param {object} params
 * @param {string} params.question  - The user's question (max 2000 chars enforced upstream)
 * @param {string} [params.sessionId] - Optional session ID for conversation grouping in LangFuse
 * @returns {Promise<{answer: string, traceId: string, latency_ms: number, tokens_used: number, cost_usd: number, knowledge_chunks: string[]}>}
 * @throws {AgentError} if Claude API fails permanently
 */
async function ask({ question, sessionId }) {
  const traceId = uuidv4();
  const startTime = Date.now();

  logger.info({ traceId, sessionId, questionLength: question.length }, 'Agent query started');

  // Step 1: Retrieve relevant context — gives Claude focused, accurate information
  const relevantChunks = findRelevantChunks(question, 3);
  const chunkIds = relevantChunks.map((c) => c.id);

  logger.debug({ traceId, chunks: chunkIds }, 'Knowledge retrieval complete');

  // Step 2: Build system prompt with retrieved context
  const systemPrompt = SYSTEM_PROMPT_TEMPLATE(relevantChunks);

  // Step 3: Call Claude
  let claudeResult;
  try {
    claudeResult = await callClaude(systemPrompt, question, traceId);
  } catch (error) {
    // Re-throw AgentError as-is; it already has the right shape for HTTP error handling
    logger.error({ traceId, error: error.message }, 'Agent query failed');
    throw error;
  }

  const totalLatency = Date.now() - startTime;

  // Step 4: Record in LangFuse asynchronously (does not block the response)
  recordTrace({
    traceId,
    sessionId,
    input: question,
    output: claudeResult.text,
    model: claudeResult.model,
    tokens: claudeResult.tokens,
    cost_usd: claudeResult.cost_usd,
    latency_ms: totalLatency,
    knowledgeChunks: chunkIds,
    systemPrompt,
  });

  logger.info(
    {
      traceId,
      latency_ms: totalLatency,
      tokens: claudeResult.tokens,
      cost_usd: claudeResult.cost_usd,
    },
    'Agent query completed'
  );

  // Step 5: Return a consistent response shape
  return {
    answer: claudeResult.text,
    trace_id: traceId,
    latency_ms: totalLatency,
    tokens_used: claudeResult.tokens.input + claudeResult.tokens.output,
    cost_usd: claudeResult.cost_usd,
    knowledge_chunks: chunkIds,
  };
}

module.exports = { ask, AgentError };
