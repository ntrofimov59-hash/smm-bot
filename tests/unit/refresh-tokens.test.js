import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { mockNotify } = vi.hoisted(() => ({ mockNotify: vi.fn() }));
vi.mock('../../agent/telegram.js', () => ({ notify: mockNotify }));

let tmpRoot;
let projectsDir;
let rt;

const LONG_TOKEN = 'IGAA' + 'x'.repeat(60);   // >50 символов → валидный
const SHORT_TOKEN = 'IGAAxxxx';                // <50 → placeholder

function makeProject(slug, accounts) {
  const dir = path.join(projectsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'accounts.json'),
    JSON.stringify({ instagram: accounts }, null, 2),
  );
  return dir;
}

function readProject(slug) {
  return JSON.parse(
    fs.readFileSync(path.join(projectsDir, slug, 'accounts.json'), 'utf8'),
  );
}

const freshAccount = (over = {}) => ({
  username: 'fresh',
  igUserId: '1',
  accessToken: LONG_TOKEN,
  active: true,
  // refreshedAt вчера → skip
  refreshedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
  ...over,
});

const staleAccount = (over = {}) => ({
  username: 'stale',
  igUserId: '2',
  accessToken: LONG_TOKEN,
  active: true,
  // 60 дней назад → refresh
  refreshedAt: new Date(Date.now() - 60 * 86400000).toISOString(),
  ...over,
});

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
  projectsDir = path.join(tmpRoot, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });

  vi.resetModules();
  vi.stubEnv('PROJECTS_DIR', projectsDir);
  mockNotify.mockReset().mockResolvedValue({ ok: true });

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  rt = await import('../../agent/refresh-tokens.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('refresh-tokens.refreshProject', () => {
  it('возвращает null если нет accounts.json', async () => {
    const dir = path.join(projectsDir, 'empty');
    fs.mkdirSync(dir);
    const r = await rt.refreshProject(dir, 'empty');
    expect(r).toBeNull();
  });

  it('возвращает null если нет instagram-аккаунтов', async () => {
    const dir = path.join(projectsDir, 'p');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify({ instagram: [] }));
    expect(await rt.refreshProject(dir, 'p')).toBeNull();
  });

  it('пропускает неактивные', async () => {
    makeProject('p', [staleAccount({ active: false })]);
    const r = await rt.refreshProject(
      path.join(projectsDir, 'p'), 'p',
      { skipDelay: true, fetchImpl: vi.fn() },
    );
    expect(r).toEqual([]);
  });

  it('пропускает токены короче 50 символов (placeholder)', async () => {
    makeProject('p', [staleAccount({ accessToken: SHORT_TOKEN })]);
    const r = await rt.refreshProject(
      path.join(projectsDir, 'p'), 'p',
      { skipDelay: true, fetchImpl: vi.fn() },
    );
    expect(r).toEqual([]);
  });

  it('пропускает свежие токены (< REFRESH_AFTER_DAYS)', async () => {
    makeProject('p', [freshAccount()]);
    const fetchImpl = vi.fn();
    const r = await rt.refreshProject(
      path.join(projectsDir, 'p'), 'p',
      { skipDelay: true, fetchImpl },
    );
    expect(r).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('обновляет устаревший токен и пишет в файл', async () => {
    makeProject('p', [staleAccount()]);
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ access_token: 'NEW_TOKEN_' + 'x'.repeat(50), expires_in: 5_184_000 }),
    });
    const r = await rt.refreshProject(
      path.join(projectsDir, 'p'), 'p',
      { skipDelay: true, fetchImpl },
    );
    expect(r).toHaveLength(1);
    expect(r[0].ok).toBe(true);
    expect(r[0].daysLeft).toBe(60);

    const saved = readProject('p');
    expect(saved.instagram[0].accessToken).toMatch(/^NEW_TOKEN_/);
    expect(saved.instagram[0].refreshedAt).toBeTruthy();
    expect(saved.instagram[0].expiresIn).toBe(5_184_000);
  });

  it('API вернул error → failed в результатах, файл не меняется', async () => {
    makeProject('p', [staleAccount()]);
    const before = readProject('p');
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ error: { message: 'Invalid token' } }),
    });
    const r = await rt.refreshProject(
      path.join(projectsDir, 'p'), 'p',
      { skipDelay: true, fetchImpl },
    );
    expect(r[0].ok).toBe(false);
    expect(r[0].error).toBe('Invalid token');
    expect(readProject('p').instagram[0].accessToken).toBe(before.instagram[0].accessToken);
  });

  it('API вернул пустой ответ без access_token → no_token', async () => {
    makeProject('p', [staleAccount()]);
    const fetchImpl = vi.fn().mockResolvedValue({ json: async () => ({}) });
    const r = await rt.refreshProject(
      path.join(projectsDir, 'p'), 'p',
      { skipDelay: true, fetchImpl },
    );
    expect(r[0].ok).toBe(false);
    expect(r[0].error).toBe('no_token');
  });

  it('сеть упала → failed, не падает всё', async () => {
    makeProject('p', [staleAccount()]);
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const r = await rt.refreshProject(
      path.join(projectsDir, 'p'), 'p',
      { skipDelay: true, fetchImpl },
    );
    expect(r[0].ok).toBe(false);
    expect(r[0].error).toBe('ECONNRESET');
  });

  it('смешанный: обновляет stale, пропускает fresh/inactive', async () => {
    makeProject('p', [
      freshAccount({ username: 'f1' }),
      staleAccount({ username: 's1' }),
      staleAccount({ username: 'inactive', active: false }),
      staleAccount({ username: 'placeholder', accessToken: SHORT_TOKEN }),
    ]);
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ access_token: 'NEW_' + 'x'.repeat(60), expires_in: 5_184_000 }),
    });
    const r = await rt.refreshProject(
      path.join(projectsDir, 'p'), 'p',
      { skipDelay: true, fetchImpl },
    );
    expect(r).toHaveLength(1);
    expect(r[0].username).toBe('s1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('refresh-tokens.main', () => {
  it('нет папки projects → projectsFound:false, no crash', async () => {
    fs.rmSync(projectsDir, { recursive: true, force: true });
    const r = await rt.main({ skipDelay: true, fetchImpl: vi.fn() });
    expect(r.projectsFound).toBe(false);
    expect(r.total).toBe(0);
  });

  it('нет проектов → 0/0/0', async () => {
    const r = await rt.main({ skipDelay: true, fetchImpl: vi.fn(), notifyImpl: mockNotify });
    expect(r.total).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('обновляет stale-аккаунт в одном проекте, отправляет отчёт', async () => {
    makeProject('p1', [staleAccount()]);
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ access_token: 'NEW_' + 'x'.repeat(60), expires_in: 5_184_000 }),
    });
    const r = await rt.main({ skipDelay: true, fetchImpl, notifyImpl: mockNotify });
    expect(r.ok).toBe(1);
    expect(r.failed).toBe(0);
    expect(mockNotify).toHaveBeenCalledOnce();
    const msg = mockNotify.mock.calls[0][0];
    expect(msg).toContain('Обновлено: <b>1</b>');
    expect(msg).toContain('Ошибки: <b>0</b>');
  });

  it('ошибки → отчёт с ⚠️ и списком проблем', async () => {
    makeProject('p1', [staleAccount()]);
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ error: { message: 'Invalid token' } }),
    });
    const r = await rt.main({ skipDelay: true, fetchImpl, notifyImpl: mockNotify });
    expect(r.failed).toBe(1);
    expect(mockNotify).toHaveBeenCalledOnce();
    const msg = mockNotify.mock.calls[0][0];
    expect(msg).toContain('⚠️');
    expect(msg).toContain('@stale: Invalid token');
  });

  it('не отправляет отчёт если нечего обновлять', async () => {
    makeProject('p1', [freshAccount()]);
    const r = await rt.main({ skipDelay: true, fetchImpl: vi.fn(), notifyImpl: mockNotify });
    expect(r.total).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('проходит по нескольким проектам', async () => {
    makeProject('p1', [staleAccount({ username: 'a' })]);
    makeProject('p2', [staleAccount({ username: 'b' })]);
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ access_token: 'NEW_' + 'x'.repeat(60), expires_in: 5_184_000 }),
    });
    const r = await rt.main({ skipDelay: true, fetchImpl, notifyImpl: mockNotify });
    expect(r.ok).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
