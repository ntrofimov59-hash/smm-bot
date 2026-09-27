import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir;
let usage;

async function loadUsage(env = {}) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  return await import('../../agent/usage.js');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'));
  vi.stubEnv('SMM_DATA_DIR', tmpDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('usage tracking', () => {
  it('начальное состояние: всё по нулям', async () => {
    usage = await loadUsage();
    const s = usage.getStatus();
    expect(s.today.groq_tokens).toBe(0);
    expect(s.today.gemini_requests).toBe(0);
    expect(s.today.posts).toBe(0);
  });

  it('trackGroq увеличивает день и месяц', async () => {
    usage = await loadUsage();
    usage.trackGroq(1500);
    usage.trackGroq(500);
    const s = usage.getStatus();
    expect(s.today.groq_tokens).toBe(2000);
    expect(s.month.groq_tokens).toBe(2000);
  });

  it('trackGroq игнорирует null/undefined', async () => {
    usage = await loadUsage();
    usage.trackGroq(null);
    usage.trackGroq(undefined);
    expect(usage.getStatus().today.groq_tokens).toBe(0);
  });

  it('trackGemini инкрементит на 1', async () => {
    usage = await loadUsage();
    usage.trackGemini();
    usage.trackGemini();
    expect(usage.getStatus().today.gemini_requests).toBe(2);
  });

  it('trackPost инкрементит день и месяц', async () => {
    usage = await loadUsage();
    usage.trackPost();
    const s = usage.getStatus();
    expect(s.today.posts).toBe(1);
    expect(s.month.posts).toBe(1);
  });

  it('trackCacheHit пишет только в день', async () => {
    usage = await loadUsage();
    usage.trackCacheHit();
    expect(usage.getStatus().today.cache_hits).toBe(1);
  });

  it('персистентность: данные сохраняются между импортами', async () => {
    usage = await loadUsage();
    usage.trackGroq(1000);
    // перезагружаем модуль
    vi.resetModules();
    const usage2 = await import('../../agent/usage.js');
    expect(usage2.getStatus().today.groq_tokens).toBe(1000);
  });
});

describe('usage limits', () => {
  it('canPublishPost: true пока лимит не достигнут', async () => {
    usage = await loadUsage({ LIMIT_POSTS_DAY: '3' });
    expect(usage.canPublishPost().ok).toBe(true);
  });

  it('canPublishPost: false когда достигнут day limit', async () => {
    usage = await loadUsage({ LIMIT_POSTS_DAY: '2' });
    usage.trackPost();
    usage.trackPost();
    const r = usage.canPublishPost();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('posts_day_limit');
  });

  it('canPublishPost: false когда достигнут month limit', async () => {
    usage = await loadUsage({ LIMIT_POSTS_DAY: '100', LIMIT_POSTS_MONTH: '2' });
    usage.trackPost();
    usage.trackPost();
    const r = usage.canPublishPost();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('posts_month_limit');
  });

  it('canCallGroq: false если tokens превысят day limit', async () => {
    usage = await loadUsage({ LIMIT_GROQ_TOKENS_DAY: '5000' });
    usage.trackGroq(4000);
    const r = usage.canCallGroq(2000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('groq_day_limit');
  });

  it('canCallGroq: true если хватает запаса', async () => {
    usage = await loadUsage({ LIMIT_GROQ_TOKENS_DAY: '10000' });
    usage.trackGroq(1000);
    expect(usage.canCallGroq(2000).ok).toBe(true);
  });

  it('canCallGemini: false по достижении day limit', async () => {
    usage = await loadUsage({ LIMIT_GEMINI_REQ_DAY: '2' });
    usage.trackGemini();
    usage.trackGemini();
    const r = usage.canCallGemini();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('gemini_day_limit');
  });

  it('проценты считаются корректно', async () => {
    usage = await loadUsage({ LIMIT_POSTS_DAY: '10' });
    usage.trackPost();
    usage.trackPost();
    usage.trackPost();
    const s = usage.getStatus();
    expect(s.today.posts_pct).toBe(30);
  });
});
