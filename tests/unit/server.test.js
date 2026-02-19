'use strict';

/**
 * HTTP layer tests for the Express server.
 *
 * Strategy:
 * - Mock the agent module completely — these tests verify routing, validation,
 *   and security middleware, not AI behaviour
 * - Each describe block that needs different env (rate limit, API key) creates
 *   its own app instance via createApp()
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

// The agent is mocked before any server module is required.
// jest.mock is hoisted, so 'ask' and 'AgentError' are always the mock versions.
jest.mock('../../src/agent/index', () => ({
  ask: jest.fn(),
  AgentError: class AgentError extends Error {
    constructor(msg, opts) {
      super(msg, opts);
      this.name = 'AgentError';
    }
  },
}));

// LangFuse is initialised inside tracing.js which is required by the agent.
// Mock it to avoid needing real credentials in CI.
jest.mock('langfuse', () => ({
  Langfuse: jest.fn().mockImplementation(() => ({
    trace: jest.fn().mockReturnValue({ generation: jest.fn() }),
    flushAsync: jest.fn().mockResolvedValue(undefined),
    shutdownAsync: jest.fn().mockResolvedValue(undefined),
  })),
}));

// ─── Setup ────────────────────────────────────────────────────────────────────

const request = require('supertest');
const { createApp } = require('../../src/server/index');
const agentModule = require('../../src/agent/index');
const { resetMetrics } = require('../../src/server/routes');

const MOCK_AGENT_RESPONSE = {
  answer: 'Use Bearer token in the Authorization header.',
  trace_id: 'test-trace-id-001',
  latency_ms: 150,
  tokens_used: 325,
  cost_usd: 0.002,
  knowledge_chunks: ['api-reference#authentication'],
};

// One app instance shared across the main describe block
const app = createApp();

beforeEach(() => {
  jest.clearAllMocks();
  resetMetrics();
  agentModule.ask.mockResolvedValue(MOCK_AGENT_RESPONSE);
});

// ─── POST /api/ask ────────────────────────────────────────────────────────────

describe('POST /api/ask', () => {
  it('retourne 200 avec réponse valide', async () => {
    const res = await request(app)
      .post('/api/ask')
      .send({ question: 'How do I authenticate with the TechCorp API?' })
      .expect('Content-Type', /json/)
      .expect(200);

    expect(res.body).toMatchObject({
      answer: expect.any(String),
      trace_id: expect.any(String),
      latency_ms: expect.any(Number),
      tokens_used: expect.any(Number),
    });
    expect(agentModule.ask).toHaveBeenCalledWith({
      question: 'How do I authenticate with the TechCorp API?',
      sessionId: undefined,
    });
  });

  it('transmet le session_id à l\'agent', async () => {
    await request(app)
      .post('/api/ask')
      .send({ question: 'test question', session_id: 'sess-abc' })
      .expect(200);

    expect(agentModule.ask).toHaveBeenCalledWith({
      question: 'test question',
      sessionId: 'sess-abc',
    });
  });

  it('retourne 400 si question vide', async () => {
    const res = await request(app)
      .post('/api/ask')
      .send({ question: '' })
      .expect(400);

    expect(res.body.error.code).toBe('INVALID_REQUEST');
    expect(agentModule.ask).not.toHaveBeenCalled();
  });

  it('retourne 400 si question absente du body', async () => {
    const res = await request(app)
      .post('/api/ask')
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('retourne 400 si question dépasse 2000 caractères', async () => {
    const res = await request(app)
      .post('/api/ask')
      .send({ question: 'a'.repeat(2001) })
      .expect(400);

    expect(res.body.error.code).toBe('INVALID_REQUEST');
    expect(res.body.error.message).toMatch(/2000/);
  });

  it('retourne 503 si l\'agent throw AgentError', async () => {
    const { AgentError } = require('../../src/agent/index');
    agentModule.ask.mockRejectedValue(new AgentError('API down'));

    const res = await request(app)
      .post('/api/ask')
      .send({ question: 'test?' })
      .expect(503);

    expect(res.body.error.code).toBe('AGENT_UNAVAILABLE');
  });

  it('retourne 500 sur erreur inattendue', async () => {
    agentModule.ask.mockRejectedValue(new Error('Unexpected crash'));

    const res = await request(app)
      .post('/api/ask')
      .send({ question: 'test?' })
      .expect(500);

    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ─── Rate Limiting ────────────────────────────────────────────────────────────

describe('POST /api/ask — rate limiting', () => {
  it('retourne 429 si rate limit dépassé', async () => {
    // Create a dedicated app with rate limit of 1 per minute
    process.env.RATE_LIMIT_MAX = '1';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    const limitedApp = createApp();
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.RATE_LIMIT_WINDOW_MS;

    // First request — should succeed
    await request(limitedApp)
      .post('/api/ask')
      .send({ question: 'first request' })
      .expect(200);

    // Second request — same IP, same window → 429
    const res = await request(limitedApp)
      .post('/api/ask')
      .send({ question: 'second request' })
      .expect(429);

    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

// ─── API Key authentication ───────────────────────────────────────────────────

describe('POST /api/ask — authentification par API key', () => {
  let secureApp;

  beforeAll(() => {
    process.env.API_KEY_REQUIRED = 'true';
    process.env.API_KEY = 'super-secret-key-for-tests';
    secureApp = createApp();
  });

  afterAll(() => {
    delete process.env.API_KEY_REQUIRED;
    delete process.env.API_KEY;
  });

  it('retourne 401 si API key manquante', async () => {
    const res = await request(secureApp)
      .post('/api/ask')
      .send({ question: 'test?' })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('retourne 401 si API key incorrecte', async () => {
    const res = await request(secureApp)
      .post('/api/ask')
      .set('X-API-Key', 'wrong-key')
      .send({ question: 'test?' })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('retourne 200 avec la bonne API key', async () => {
    await request(secureApp)
      .post('/api/ask')
      .set('X-API-Key', 'super-secret-key-for-tests')
      .send({ question: 'test with valid key' })
      .expect(200);
  });
});

// ─── GET /health ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('retourne 200 avec le bon format', async () => {
    const res = await request(app).get('/health').expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      model: expect.any(String),
      uptime_seconds: expect.any(Number),
      version: expect.any(String),
    });
    expect(res.body.status).toBe('ok');
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });
});

// ─── GET /metrics ─────────────────────────────────────────────────────────────

describe('GET /metrics', () => {
  it('retourne 200 avec les métriques initiales à zéro', async () => {
    const res = await request(app).get('/metrics').expect(200);

    expect(res.body).toMatchObject({
      requests_total: 0,
      avg_latency_ms: 0,
      errors_total: 0,
    });
  });

  it('incrémente requests_total après un appel réussi', async () => {
    await request(app).post('/api/ask').send({ question: 'test count' }).expect(200);

    const res = await request(app).get('/metrics').expect(200);
    expect(res.body.requests_total).toBe(1);
    expect(res.body.errors_total).toBe(0);
    expect(res.body.avg_latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('incrémente errors_total après une erreur agent', async () => {
    const { AgentError } = require('../../src/agent/index');
    agentModule.ask.mockRejectedValue(new AgentError('down'));

    await request(app).post('/api/ask').send({ question: 'fail' }).expect(503);

    const res = await request(app).get('/metrics').expect(200);
    expect(res.body.errors_total).toBe(1);
  });
});

// ─── 404 ─────────────────────────────────────────────────────────────────────

describe('Routes inconnues', () => {
  it('retourne 404 pour une route inexistante', async () => {
    const res = await request(app).get('/api/unknown').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
