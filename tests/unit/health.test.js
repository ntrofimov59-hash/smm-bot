import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockGetStats, mockGetStatus } = vi.hoisted(() => ({
  mockGetStats: vi.fn(),
  mockGetStatus: vi.fn(),
}));

vi.mock('../../agent/queue.js', () => ({ getStats: mockGetStats }));
vi.mock('../../agent/usage.js', () => ({ getStatus: mockGetStatus }));

let health;

function seedDefaults() {
  mockGetStats.mockReturnValue({
    pending: 0, publishing: 0, published: 3, failed: 0, total: 3,
  });
  mockGetStatus.mockReturnValue({
    today: {
      groq_tokens: 1000, gemini_requests: 5, posts: 2, cache_hits: 10,
      groq_tokens_pct: 10, gemini_requests_pct: 5, posts_pct: 10,
    },
    month: { groq_tokens: 10000, gemini_requests: 50, posts: 20 },
    limits: { groq_tokens_day: 200000, gemini_requests_day: 1500, posts_day: 20 },
  });
}

beforeEach(async () => {
  vi.resetModules();
  mockGetStats.mockReset();
  mockGetStatus.mockReset();
  seedDefaults();
  health = await import('../../agent/health.js');
});

afterEach(async () => {
  await health.stopHealthServer();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function startEphemeral() {
  const server = await health.startHealthServer({ port: 0, host: '127.0.0.1' });
  return server.address().port;
}

async function get(port, path, opts) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
  return { status: res.status, headers: res.headers, body: await res.text() };
}

describe('GET /health', () => {
  it('returns 200 with status ok, uptime, version', async () => {
    const port = await startEphemeral();
    const r = await get(port, '/health');
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof body.uptimeHuman).toBe('string');
    expect(body.version).toBeTruthy();
  });

  it('/healthz alias works', async () => {
    const port = await startEphemeral();
    expect((await get(port, '/healthz')).status).toBe(200);
  });

  it('returns no-store cache header', async () => {
    const port = await startEphemeral();
    const r = await get(port, '/health');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});

describe('GET /status', () => {
  it('includes queue, usage, backend, uptime', async () => {
    const port = await startEphemeral();
    const body = JSON.parse((await get(port, '/status')).body);
    expect(body.status).toBe('ok');
    expect(body.backend).toBe('json');
    expect(body.queue.published).toBe(3);
    expect(body.queue.total).toBe(3);
    expect(body.usage.today.groq_tokens).toBe(1000);
    expect(typeof body.uptime).toBe('number');
  });

  it('reports custom QUEUE_BACKEND', async () => {
    vi.stubEnv('QUEUE_BACKEND', 'sqlite');
    vi.resetModules();
    const h = await import('../../agent/health.js');
    const server = await h.startHealthServer({ port: 0, host: '127.0.0.1' });
    const port = server.address().port;
    const body = JSON.parse((await get(port, '/status')).body);
    expect(body.backend).toBe('sqlite');
    await h.stopHealthServer();
  });

  it('survives queue.getStats error', async () => {
    mockGetStats.mockImplementationOnce(() => { throw new Error('db locked'); });
    const port = await startEphemeral();
    const body = JSON.parse((await get(port, '/status')).body);
    expect(body.queue.error).toBe('db locked');
  });

  it('survives usage.getStatus error', async () => {
    mockGetStatus.mockImplementationOnce(() => { throw new Error('usage corrupt'); });
    const port = await startEphemeral();
    const body = JSON.parse((await get(port, '/status')).body);
    expect(body.usage.error).toBe('usage corrupt');
  });
});

describe('GET /metrics', () => {
  it('returns Prometheus text format with expected metrics', async () => {
    const port = await startEphemeral();
    const r = await get(port, '/metrics');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/plain');
    expect(r.body).toContain('# HELP smm_bot_uptime_seconds');
    expect(r.body).toContain('# TYPE smm_bot_queue_published gauge');
    expect(r.body).toContain('smm_bot_queue_published 3');
    expect(r.body).toContain('smm_bot_queue_pending 0');
    expect(r.body).toContain('smm_bot_groq_tokens_today 1000');
    expect(r.body).toContain('smm_bot_cache_hits_today 10');
  });

  it('omits queue metrics if getStats throws', async () => {
    mockGetStats.mockImplementationOnce(() => { throw new Error('db'); });
    const port = await startEphemeral();
    const r = await get(port, '/metrics');
    expect(r.status).toBe(200);
    expect(r.body).toContain('smm_bot_uptime_seconds');
    expect(r.body).not.toContain('smm_bot_queue_published');
  });
});

describe('routing', () => {
  it('404 for unknown path', async () => {
    const port = await startEphemeral();
    const r = await get(port, '/unknown');
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body).error).toBe('not_found');
  });

  it('405 for POST', async () => {
    const port = await startEphemeral();
    const r = await get(port, '/health', { method: 'POST' });
    expect(r.status).toBe(405);
    expect(JSON.parse(r.body).error).toBe('method_not_allowed');
  });

  it('root returns friendly text with endpoints', async () => {
    const port = await startEphemeral();
    const r = await get(port, '/');
    expect(r.status).toBe(200);
    expect(r.body).toContain('/health');
    expect(r.body).toContain('/metrics');
  });

  it('query string is ignored', async () => {
    const port = await startEphemeral();
    expect((await get(port, '/health?foo=bar')).status).toBe(200);
  });
});

describe('lifecycle', () => {
  it('startHealthServer is idempotent', async () => {
    const s1 = await health.startHealthServer({ port: 0, host: '127.0.0.1' });
    const s2 = await health.startHealthServer({ port: 0, host: '127.0.0.1' });
    expect(s1).toBe(s2);
  });

  it('HEALTH_PORT=0 disables the server', async () => {
    vi.stubEnv('HEALTH_PORT', '0');
    vi.resetModules();
    const h = await import('../../agent/health.js');
    const s = await h.startHealthServer();
    expect(s).toBeNull();
  });

  it('HEALTH_PORT=off disables the server', async () => {
    vi.stubEnv('HEALTH_PORT', 'off');
    vi.resetModules();
    const h = await import('../../agent/health.js');
    const s = await h.startHealthServer();
    expect(s).toBeNull();
  });

  it('stopHealthServer frees the port', async () => {
    const port = await startEphemeral();
    await health.stopHealthServer();
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });

  it('getHealthServer returns server while running, null after stop', async () => {
    const s = await health.startHealthServer({ port: 0, host: '127.0.0.1' });
    expect(health.getHealthServer()).toBe(s);
    await health.stopHealthServer();
    expect(health.getHealthServer()).toBeNull();
  });
});
