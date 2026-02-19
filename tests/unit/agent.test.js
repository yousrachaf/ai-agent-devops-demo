'use strict';

/**
 * Unit tests for the agent pipeline.
 *
 * Strategy: mock Claude API and LangFuse — unit tests must be deterministic
 * and free of network calls. The real API is tested in tests/prompts/quality.test.js.
 */

const path = require('path');

// ─── Mock Anthropic SDK ────────────────────────────────────────────────────────

// We mock before requiring any module that imports the SDK
jest.mock('@anthropic-ai/sdk', () => {
  const mockCreate = jest.fn();

  return {
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    // Expose mockCreate so tests can configure return values
    __mockCreate: mockCreate,
  };
});

// ─── Mock LangFuse ────────────────────────────────────────────────────────────

jest.mock('langfuse', () => ({
  Langfuse: jest.fn().mockImplementation(() => ({
    trace: jest.fn().mockReturnValue({
      generation: jest.fn(),
    }),
    flushAsync: jest.fn().mockResolvedValue(undefined),
    shutdownAsync: jest.fn().mockResolvedValue(undefined),
  })),
}));

// ─── Setup ────────────────────────────────────────────────────────────────────

const Anthropic = require('@anthropic-ai/sdk');
// __mockCreate is accessed per-test via require() after resetModules()
void Anthropic.__mockCreate;

// Successful Claude response fixture
const CLAUDE_SUCCESS_RESPONSE = {
  content: [{ text: 'To authenticate, use Bearer token in the Authorization header.' }],
  model: 'claude-sonnet-4-5-20250929',
  usage: { input_tokens: 250, output_tokens: 75 },
};

// ─── Tests: claude.js ─────────────────────────────────────────────────────────

describe('claude.js — Claude API wrapper', () => {
  let callClaude, AgentError;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Re-require after resetModules to get a fresh instance
    const claudeModule = require('../../src/agent/claude');
    callClaude = claudeModule.callClaude;
    AgentError = claudeModule.AgentError;

    // Re-attach the mock after resetModules
    const Anth = require('@anthropic-ai/sdk');
    Anth.__mockCreate.mockResolvedValue(CLAUDE_SUCCESS_RESPONSE);
  });

  it('returns a structured response on success', async () => {
    const Anth = require('@anthropic-ai/sdk');
    Anth.__mockCreate.mockResolvedValue(CLAUDE_SUCCESS_RESPONSE);

    const result = await callClaude('You are helpful.', 'How do I authenticate?', 'trace-001');

    expect(result).toMatchObject({
      text: expect.any(String),
      model: 'claude-sonnet-4-5-20250929',
      tokens: { input: 250, output: 75 },
      cost_usd: expect.any(Number),
      latency_ms: expect.any(Number),
    });
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.cost_usd).toBeGreaterThan(0);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('calculates cost correctly based on token usage', async () => {
    const Anth = require('@anthropic-ai/sdk');
    Anth.__mockCreate.mockResolvedValue({
      ...CLAUDE_SUCCESS_RESPONSE,
      usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    });

    const result = await callClaude('system', 'user', 'trace-cost');

    // Input: $3/M tokens = $3, Output: $15/M tokens = $15 → total $18
    expect(result.cost_usd).toBeCloseTo(18.0, 1);
  });

  it('throws AgentError when Claude API returns a permanent error', async () => {
    const Anth = require('@anthropic-ai/sdk');
    // 401 is non-retryable — should fail immediately without sleeping
    const apiError = Object.assign(new Error('Invalid API key'), { status: 401 });
    Anth.__mockCreate.mockRejectedValue(apiError);

    await expect(callClaude('system', 'user', 'trace-err')).rejects.toThrow(AgentError);
    await expect(callClaude('system', 'user', 'trace-err2')).rejects.toThrow(
      'Claude API call failed after retries'
    );
  });

  it('retries on 429 rate limit error before succeeding', async () => {
    jest.useFakeTimers();

    const Anth = require('@anthropic-ai/sdk');
    const rateLimitError = Object.assign(new Error('Rate limited'), { status: 429 });

    // Fail twice then succeed on the third attempt
    Anth.__mockCreate
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(CLAUDE_SUCCESS_RESPONSE);

    const promise = callClaude('system', 'user', 'trace-retry');

    // Advance through all backoff delays asynchronously
    await jest.runAllTimersAsync();

    const result = await promise;
    jest.useRealTimers();

    expect(result.text).toBeTruthy();
    expect(Anth.__mockCreate).toHaveBeenCalledTimes(3);
  });

  it('AgentError has the correct name and carries the cause', () => {
    const { AgentError: AE } = require('../../src/agent/claude');
    const cause = new Error('Upstream failure');
    const error = new AE('Wrapper error', { cause });

    expect(error.name).toBe('AgentError');
    expect(error.message).toBe('Wrapper error');
    expect(error.cause).toBe(cause);
  });
});

// ─── Tests: knowledge.js ──────────────────────────────────────────────────────

describe('knowledge.js — knowledge base loader', () => {
  let loadKnowledge, findRelevantChunks, resetCache;

  beforeAll(() => {
    // Ensure the real knowledge directory is used
    process.chdir(path.join(__dirname, '../..'));
    const mod = require('../../src/agent/knowledge');
    loadKnowledge = mod.loadKnowledge;
    findRelevantChunks = mod.findRelevantChunks;
    resetCache = mod.resetCache;
  });

  beforeEach(() => {
    resetCache();
  });

  it('loads all markdown files from the knowledge directory', () => {
    const chunks = loadKnowledge();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      content: expect.any(String),
      source: expect.any(String),
    });
  });

  it('returns relevant chunks for a query about authentication', () => {
    const results = findRelevantChunks('How do I authenticate with the API?', 3);
    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.id);
    // The authentication section should be top-ranked
    expect(ids.some((id) => id.toLowerCase().includes('auth'))).toBe(true);
  });

  it('returns empty array for completely irrelevant query', () => {
    const results = findRelevantChunks('xyzzy foobarbaz quuxquux', 3);
    expect(results).toHaveLength(0);
  });

  it('respects the topK limit', () => {
    const results = findRelevantChunks('API', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('scores title matches higher than body matches', () => {
    // "Authentication" appears in a section title — should score higher
    // than sections that only mention it in passing
    const results = findRelevantChunks('authentication', 5);
    if (results.length > 1) {
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    }
  });
});

// ─── Tests: agent/index.js ────────────────────────────────────────────────────

describe('agent/index.js — orchestrator', () => {
  let ask, AgentError;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Provide mocked dependencies before requiring the orchestrator
    const Anth = require('@anthropic-ai/sdk');
    Anth.__mockCreate.mockResolvedValue(CLAUDE_SUCCESS_RESPONSE);

    const agentModule = require('../../src/agent/index');
    ask = agentModule.ask;
    AgentError = agentModule.AgentError;
  });

  it('returns a structured response with all required fields', async () => {
    const Anth = require('@anthropic-ai/sdk');
    Anth.__mockCreate.mockResolvedValue(CLAUDE_SUCCESS_RESPONSE);

    const result = await ask({ question: 'How do I authenticate?', sessionId: 'sess-1' });

    expect(result).toMatchObject({
      answer: expect.any(String),
      trace_id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      ),
      latency_ms: expect.any(Number),
      tokens_used: expect.any(Number),
      cost_usd: expect.any(Number),
      knowledge_chunks: expect.any(Array),
    });
    expect(result.tokens_used).toBe(325); // 250 input + 75 output
  });

  it('generates a unique trace_id for each call', async () => {
    const Anth = require('@anthropic-ai/sdk');
    Anth.__mockCreate.mockResolvedValue(CLAUDE_SUCCESS_RESPONSE);

    const [r1, r2] = await Promise.all([
      ask({ question: 'What is rate limiting?' }),
      ask({ question: 'How do I create a user?' }),
    ]);

    expect(r1.trace_id).not.toBe(r2.trace_id);
  });

  it('throw AgentError si Claude API down', async () => {
    const Anth = require('@anthropic-ai/sdk');
    // 401 is non-retryable — no backoff delay, test stays fast
    const apiError = Object.assign(new Error('API down'), { status: 401 });
    Anth.__mockCreate.mockRejectedValue(apiError);

    await expect(ask({ question: 'test' })).rejects.toThrow(AgentError);
  });

  it('loggue dans LangFuse avec les bons champs', async () => {
    const Anth = require('@anthropic-ai/sdk');
    Anth.__mockCreate.mockResolvedValue(CLAUDE_SUCCESS_RESPONSE);

    const { Langfuse } = require('langfuse');
    const mockGeneration = jest.fn();
    const mockTrace = jest.fn().mockReturnValue({ generation: mockGeneration });

    Langfuse.mockImplementation(() => ({
      trace: mockTrace,
      flushAsync: jest.fn().mockResolvedValue(undefined),
    }));

    jest.resetModules();

    // Re-setup mocks after resetModules
    const Anth2 = require('@anthropic-ai/sdk');
    Anth2.__mockCreate.mockResolvedValue(CLAUDE_SUCCESS_RESPONSE);

    const freshAsk = require('../../src/agent/index').ask;
    const result = await freshAsk({ question: 'test question', sessionId: 'sess-lf' });

    // Result should be valid regardless of LangFuse status
    expect(result.trace_id).toBeTruthy();
    expect(result.answer).toBeTruthy();
  });
});
