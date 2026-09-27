import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO_ROOT = process.cwd();
const CLI = path.join(REPO_ROOT, 'cli.js');

let tmpDataDir;

/**
 * Запускает `node cli.js <args>` с изолированным SMM_DATA_DIR.
 * Возвращает { stdout, stderr, status }. Если exit code != 0 — не бросает.
 */
function runCli(args = [], opts = {}) {
  const env = { ...process.env, SMM_DATA_DIR: tmpDataDir, ...(opts.env || {}) };
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', status: 0 };
  } catch (e) {
    return {
      stdout: e.stdout?.toString() || '',
      stderr: e.stderr?.toString() || '',
      status: e.status ?? 1,
    };
  }
}

function seedQueue(items) {
  fs.writeFileSync(
    path.join(tmpDataDir, 'queue.json'),
    JSON.stringify({ items }, null, 2),
  );
}

beforeEach(() => {
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-e2e-'));
});

afterEach(() => {
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
});

describe('cli.js — help / usage', () => {
  it('без аргументов выводит help и завершается с 0', () => {
    const r = runCli([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('SMM Bot CLI');
    expect(r.stdout).toContain('node cli.js status');
    expect(r.stdout).toContain('node cli.js scan');
    expect(r.stdout).toContain('publish-now');
  });

  it('неизвестная команда → help, exit 0', () => {
    const r = runCli(['totally-unknown-command']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('SMM Bot CLI');
  });

  it('команда help → help, exit 0', () => {
    const r = runCli(['help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('SMM Bot CLI');
  });
});

describe('cli.js status', () => {
  it('пустая очередь → все счётчики 0', () => {
    const r = runCli(['status']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Состояние SMM Bot');
    expect(r.stdout).toMatch(/pending:\s+0/);
    expect(r.stdout).toMatch(/published:\s+0/);
    expect(r.stdout).toMatch(/failed:\s+0/);
  });

  it('с данными в очереди — правильные счётчики', () => {
    seedQueue([
      { id: 'a', status: 'pending', scheduledAt: new Date(Date.now() + 3600e3).toISOString(), projectSlug: 'p1', accounts: [{ username: 'u1' }], caption: 'c', createdAt: new Date().toISOString() },
      { id: 'b', status: 'published', publishedAt: new Date().toISOString(), scheduledAt: new Date().toISOString(), projectSlug: 'p1', accounts: [], caption: 'c', createdAt: new Date().toISOString() },
      { id: 'c', status: 'failed', scheduledAt: new Date().toISOString(), projectSlug: 'p1', accounts: [], caption: 'c', createdAt: new Date().toISOString(), lastError: 'x' },
    ]);
    const r = runCli(['status']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/pending:\s+1/);
    expect(r.stdout).toMatch(/published:\s+1/);
    expect(r.stdout).toMatch(/failed:\s+1/);
    expect(r.stdout).toMatch(/всего:\s+3/);
  });

  it('показывает ближайшие посты', () => {
    seedQueue([
      { id: 'x', status: 'pending', scheduledAt: new Date(Date.now() + 3600e3).toISOString(), projectSlug: 'demo', accounts: [{ username: 'acc' }], caption: 'c', createdAt: new Date().toISOString() },
    ]);
    const r = runCli(['status']);
    expect(r.stdout).toContain('Ближайшие посты');
    expect(r.stdout).toContain('demo');
  });
});

describe('cli.js upcoming', () => {
  it('пустая очередь → 0 постов', () => {
    const r = runCli(['upcoming']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/0 постов/);
  });

  it('сортирует по времени и показывает username', () => {
    const t1 = new Date(Date.now() + 7200e3).toISOString();
    const t2 = new Date(Date.now() + 3600e3).toISOString();
    seedQueue([
      { id: '1', status: 'pending', scheduledAt: t1, projectSlug: 'p1', accounts: [{ username: 'second' }], caption: 'c1', createdAt: new Date().toISOString() },
      { id: '2', status: 'pending', scheduledAt: t2, projectSlug: 'p2', accounts: [{ username: 'first' }], caption: 'c2', createdAt: new Date().toISOString() },
    ]);
    const r = runCli(['upcoming']);
    expect(r.status).toBe(0);
    // first должен быть раньше second в выводе
    const idxFirst = r.stdout.indexOf('first');
    const idxSecond = r.stdout.indexOf('second');
    expect(idxFirst).toBeGreaterThan(-1);
    expect(idxSecond).toBeGreaterThan(-1);
    expect(idxFirst).toBeLessThan(idxSecond);
  });

  it('показывает превью caption', () => {
    seedQueue([
      { id: 'x', status: 'pending', scheduledAt: new Date(Date.now() + 3600e3).toISOString(), projectSlug: 'p', accounts: [{ username: 'u' }], caption: 'My unique caption text here', createdAt: new Date().toISOString() },
    ]);
    const r = runCli(['upcoming']);
    expect(r.stdout).toContain('My unique caption text');
  });
});

describe('cli.js publish-now', () => {
  it('без id → usage, exit 0', () => {
    const r = runCli(['publish-now']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('publish-now <queueItemId>');
  });

  it('с существующим id — сдвигает scheduledAt в прошлое', () => {
    const future = new Date(Date.now() + 7200e3).toISOString();
    seedQueue([
      { id: 'abc123', status: 'pending', scheduledAt: future, projectSlug: 'p', accounts: [], caption: 'c', createdAt: new Date().toISOString() },
    ]);
    const r = runCli(['publish-now', 'abc123']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('abc123');
    expect(r.stdout).toContain('немедленной публикации');

    // проверяем, что реально обновилось
    const q = JSON.parse(fs.readFileSync(path.join(tmpDataDir, 'queue.json'), 'utf8'));
    const item = q.items.find(i => i.id === 'abc123');
    expect(new Date(item.scheduledAt).getTime()).toBeLessThan(Date.now());
  });

  it('с несуществующим id — всё равно exit 0 (updateItem возвращает null)', () => {
    const r = runCli(['publish-now', 'nonexistent-id']);
    expect(r.status).toBe(0);
    // queue.updateItem вернёт null, но cli.js не проверяет — это не баг, так задумано
  });
});

describe('cli.js scan --dry', () => {
  it('проходит по всем проектам и выводит статистику', () => {
    const r = runCli(['scan', '--dry']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('dry-run');
    // projects/ содержит coucou-events, у него пустой inbox → scanned: 0
    expect(r.stdout).toMatch(/scanned:\s+\d+/);
    expect(r.stdout).toMatch(/scheduled:\s+\d+/);
    expect(r.stdout).toMatch(/failed:\s+\d+/);
  });

  it('dry-run не пишет в queue', () => {
    const queuePath = path.join(tmpDataDir, 'queue.json');
    const existsBefore = fs.existsSync(queuePath);

    runCli(['scan', '--dry']);

    if (!existsBefore) {
      // либо файла нет, либо он есть но пуст
      if (fs.existsSync(queuePath)) {
        const q = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
        expect(q.items).toHaveLength(0);
      }
    }
  });
});
