import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-facade-'));
  vi.stubEnv('SMM_DATA_DIR', tmpDir);
  vi.unstubAllEnvs();
  vi.stubEnv('SMM_DATA_DIR', tmpDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function loadFacade(backend) {
  vi.stubEnv('QUEUE_BACKEND', backend);
  vi.stubEnv('SMM_DATA_DIR', tmpDir);
  vi.resetModules();
  return await import('../../agent/queue.js');
}

const makeItem = (overrides = {}) => ({
  scheduledAt: new Date().toISOString(),
  projectSlug: 'p', projectPath: '/tmp/p',
  imagePath: '/tmp/a.jpg', imageUrl: 'https://x/a.jpg',
  accounts: [], caption: 'c', hashtags: [],
  ...overrides,
});

describe('queue facade — backend selection', () => {
  it('default backend = json', async () => {
    vi.stubEnv('QUEUE_BACKEND', '');
    vi.stubEnv('SMM_DATA_DIR', tmpDir);
    vi.resetModules();
    const q = await import('../../agent/queue.js');
    expect(q.getBackendName()).toBe('json');
  });

  it('QUEUE_BACKEND=json → uses queue.json file', async () => {
    const q = await loadFacade('json');
    q.enqueue(makeItem());
    expect(fs.existsSync(path.join(tmpDir, 'queue.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'queue.db'))).toBe(false);
  });

  it('QUEUE_BACKEND=sqlite → uses queue.db file', async () => {
    const q = await loadFacade('sqlite');
    q.enqueue(makeItem());
    expect(fs.existsSync(path.join(tmpDir, 'queue.db'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'queue.json'))).toBe(false);
  });

  it('unknown backend throws with clear message', async () => {
    const q = await loadFacade('postgres');
    expect(() => q.getBackendName()).toThrow(/неизвестный QUEUE_BACKEND="postgres"/);
  });

  it('case-insensitive backend name', async () => {
    const q = await loadFacade('SQLITE');
    expect(q.getBackendName()).toBe('sqlite');
  });

  it('forwards getStats to selected backend', async () => {
    const q = await loadFacade('sqlite');
    q.enqueue(makeItem());
    q.enqueue(makeItem());
    expect(q.getStats().total).toBe(2);
  });
});

describe('queue migration — JSON → SQLite', () => {
  it('returns zeros when no JSON file exists', async () => {
    vi.stubEnv('QUEUE_BACKEND', 'sqlite');
    vi.stubEnv('SMM_DATA_DIR', tmpDir);
    vi.resetModules();
    const { migrateJsonToSqlite } = await import('../../agent/queue-migrate.js');
    const r = await migrateJsonToSqlite();
    expect(r).toEqual({ total: 0, migrated: 0, skipped: 0, deletedOld: false });
  });

  it('migrates all items from queue.json to queue.db', async () => {
    // 1. Готовим JSON-файл вручную
    const jsonPath = path.join(tmpDir, 'queue.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
      items: [
        { id: 'a1', status: 'pending', createdAt: '2026-01-01T00:00:00Z', scheduledAt: '2026-06-01T11:00:00Z', projectSlug: 'p', accounts: [], caption: 'c1', hashtags: ['#a'] },
        { id: 'a2', status: 'published', createdAt: '2026-01-02T00:00:00Z', scheduledAt: '2026-06-02T11:00:00Z', publishedAt: '2026-06-02T11:00:01Z', projectSlug: 'p', accounts: [], caption: 'c2', hashtags: [] },
      ],
    }));

    // 2. Мигрируем
    vi.stubEnv('SMM_DATA_DIR', tmpDir);
    vi.resetModules();
    const { migrateJsonToSqlite } = await import('../../agent/queue-migrate.js');
    const r = await migrateJsonToSqlite();

    expect(r.total).toBe(2);
    expect(r.migrated).toBe(2);
    expect(r.skipped).toBe(0);
    expect(r.deletedOld).toBe(false);

    // 3. Проверяем, что данные в SQLite
    const sqlite = await import('../../agent/queue-sqlite.js');
    expect(sqlite.getById('a1')).toMatchObject({ id: 'a1', status: 'pending', caption: 'c1' });
    expect(sqlite.getById('a2').publishedAt).toBeTruthy();
    sqlite._closeDb();
  });

  it('idempotent — second run skips all', async () => {
    const jsonPath = path.join(tmpDir, 'queue.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
      items: [{ id: 'x1', status: 'pending', createdAt: '2026-01-01T00:00:00Z', scheduledAt: '2026-06-01T11:00:00Z', accounts: [], caption: 'c', hashtags: [] }],
    }));

    vi.stubEnv('SMM_DATA_DIR', tmpDir);
    vi.resetModules();
    const { migrateJsonToSqlite } = await import('../../agent/queue-migrate.js');
    await migrateJsonToSqlite();
    const r2 = await migrateJsonToSqlite();

    expect(r2.migrated).toBe(0);
    expect(r2.skipped).toBe(1);

    const sqlite = await import('../../agent/queue-sqlite.js');
    sqlite._closeDb();
  });

  it('deleteOld=true renames queue.json to queue.json.migrated', async () => {
    const jsonPath = path.join(tmpDir, 'queue.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
      items: [{ id: 'y1', status: 'pending', createdAt: '2026-01-01T00:00:00Z', scheduledAt: '2026-06-01T11:00:00Z', accounts: [], caption: 'c', hashtags: [] }],
    }));

    vi.stubEnv('SMM_DATA_DIR', tmpDir);
    vi.resetModules();
    const { migrateJsonToSqlite } = await import('../../agent/queue-migrate.js');
    const r = await migrateJsonToSqlite({ deleteOld: true });

    expect(r.deletedOld).toBe(true);
    expect(fs.existsSync(jsonPath)).toBe(false);
    expect(fs.existsSync(jsonPath + '.migrated')).toBe(true);

    const sqlite = await import('../../agent/queue-sqlite.js');
    sqlite._closeDb();
  });
});

describe('queue-migrate.getQueueInfo', () => {
  it('reports json backend by default', async () => {
    vi.stubEnv('QUEUE_BACKEND', 'json');
    vi.stubEnv('SMM_DATA_DIR', tmpDir);
    vi.resetModules();
    const { getQueueInfo } = await import('../../agent/queue-migrate.js');
    const info = getQueueInfo();
    expect(info.backend).toBe('json');
    expect(info.path).toContain('queue.json');
    expect(info.exists).toBe(false);
  });

  it('reports sqlite backend when env set', async () => {
    vi.stubEnv('QUEUE_BACKEND', 'sqlite');
    vi.stubEnv('SMM_DATA_DIR', tmpDir);
    vi.resetModules();
    const { getQueueInfo } = await import('../../agent/queue-migrate.js');
    const info = getQueueInfo();
    expect(info.backend).toBe('sqlite');
    expect(info.path).toContain('queue.db');
  });
});
