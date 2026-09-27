import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

let tmpDir;
let q;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-sqlite-'));
  vi.stubEnv('SMM_DATA_DIR', tmpDir);
  vi.resetModules();
  q = await import('../../agent/queue-sqlite.js');
});

afterEach(() => {
  q._closeDb?.();
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const makeItem = (overrides = {}) => ({
  scheduledAt: new Date().toISOString(),
  projectSlug: 'coucou-events',
  projectPath: '/tmp/proj',
  imagePath: '/tmp/a.jpg',
  imageUrl: 'https://example.com/a.jpg',
  accounts: [{ username: 'test', igUserId: '1', accessToken: 'tok', city: 'phuket' }],
  caption: 'test caption',
  hashtags: ['#test'],
  ...overrides,
});

describe('queue-sqlite.enqueue', () => {
  it('создаёт запись со status=pending и уникальным id', () => {
    const e = q.enqueue(makeItem());
    expect(e.id).toBeTruthy();
    expect(e.status).toBe('pending');
    expect(e.attempts).toBe(0);
    expect(e.publishedPostIds).toEqual([]);
  });

  it('генерирует разные id для двух записей', () => {
    expect(q.enqueue(makeItem()).id).not.toBe(q.enqueue(makeItem()).id);
  });

  it('создаёт файл queue.db', () => {
    q.enqueue(makeItem());
    expect(fs.existsSync(path.join(tmpDir, 'queue.db'))).toBe(true);
  });

  it('сохраняет accounts и hashtags как JSON внутри БД', () => {
    const e = q.enqueue(makeItem({ hashtags: ['#a', '#b'] }));
    const loaded = q.getById(e.id);
    expect(loaded.accounts[0].username).toBe('test');
    expect(loaded.hashtags).toEqual(['#a', '#b']);
  });
});

describe('queue-sqlite.getPending', () => {
  it('возвращает только due-посты', () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const future = new Date(Date.now() + 60000).toISOString();
    q.enqueue(makeItem({ scheduledAt: past }));
    q.enqueue(makeItem({ scheduledAt: future }));
    const p = q.getPending();
    expect(p).toHaveLength(1);
    expect(p[0].scheduledAt).toBe(past);
  });

  it('не возвращает published/failed', () => {
    const e = q.enqueue(makeItem({ scheduledAt: new Date(Date.now() - 1000).toISOString() }));
    q.markPublished(e.id, ['p1']);
    expect(q.getPending()).toHaveLength(0);
  });

  it('сортирует по scheduled_at', () => {
    const t1 = new Date(Date.now() - 1000).toISOString();
    const t2 = new Date(Date.now() - 5000).toISOString();
    q.enqueue(makeItem({ scheduledAt: t1 }));
    q.enqueue(makeItem({ scheduledAt: t2 }));
    const p = q.getPending();
    expect(p[0].scheduledAt).toBe(t2);
    expect(p[1].scheduledAt).toBe(t1);
  });
});

describe('queue-sqlite.getUpcoming', () => {
  it('сортирует и соблюдает limit', () => {
    q.enqueue(makeItem({ scheduledAt: new Date(Date.now() + 30000).toISOString() }));
    q.enqueue(makeItem({ scheduledAt: new Date(Date.now() + 10000).toISOString() }));
    q.enqueue(makeItem({ scheduledAt: new Date(Date.now() + 20000).toISOString() }));
    const up = q.getUpcoming({ limit: 2 });
    expect(up).toHaveLength(2);
    expect(new Date(up[0].scheduledAt).getTime()).toBeLessThan(new Date(up[1].scheduledAt).getTime());
  });
});

describe('queue-sqlite.getStats', () => {
  it('считает по каждому статусу', () => {
    const a = q.enqueue(makeItem());
    const b = q.enqueue(makeItem());
    q.enqueue(makeItem());
    q.markPublished(a.id, ['p1']);
    q.markFailed(b.id, 'error');
    const s = q.getStats();
    expect(s.total).toBe(3);
    expect(s.pending).toBe(1);
    expect(s.published).toBe(1);
    expect(s.failed).toBe(1);
  });

  it('пустая очередь → все нули', () => {
    const s = q.getStats();
    expect(s.total).toBe(0);
    expect(s.pending).toBe(0);
  });
});

describe('queue-sqlite.updateItem', () => {
  it('обновляет поле caption', () => {
    const e = q.enqueue(makeItem());
    expect(q.updateItem(e.id, { caption: 'new' }).caption).toBe('new');
  });

  it('возвращает null для несуществующего id', () => {
    expect(q.updateItem('nope', {})).toBeNull();
  });

  it('обновляет accounts как JSON', () => {
    const e = q.enqueue(makeItem());
    q.updateItem(e.id, { accounts: [{ username: 'new' }] });
    expect(q.getById(e.id).accounts[0].username).toBe('new');
  });

  it('обновляет publishedPostIds как JSON', () => {
    const e = q.enqueue(makeItem());
    q.updateItem(e.id, { publishedPostIds: [{ postId: 'p1' }] });
    expect(q.getById(e.id).publishedPostIds).toEqual([{ postId: 'p1' }]);
  });

  it('пустой patch не падает', () => {
    const e = q.enqueue(makeItem());
    expect(q.updateItem(e.id, {}).id).toBe(e.id);
  });
});

describe('queue-sqlite.markPublished / markFailed', () => {
  it('markPublished ставит status и publishedAt', () => {
    const e = q.enqueue(makeItem());
    const p = q.markPublished(e.id, [{ username: 'x', postId: 'p1' }]);
    expect(p.status).toBe('published');
    expect(p.publishedAt).toBeTruthy();
    expect(p.publishedPostIds).toHaveLength(1);
    expect(p.lastError).toBeNull();
  });

  it('markFailed сохраняет ошибку и обрезает до 500', () => {
    const e = q.enqueue(makeItem());
    const f = q.markFailed(e.id, 'x'.repeat(1000));
    expect(f.status).toBe('failed');
    expect(f.lastError).toHaveLength(500);
  });
});

describe('queue-sqlite.incrementAttempts', () => {
  it('инкрементит в транзакции (не read-modify-write)', () => {
    const e = q.enqueue(makeItem());
    q.incrementAttempts(e.id);
    q.incrementAttempts(e.id);
    q.incrementAttempts(e.id);
    expect(q.getById(e.id).attempts).toBe(3);
  });

  it('игнорирует несуществующий id', () => {
    expect(() => q.incrementAttempts('nope')).not.toThrow();
  });
});

describe('queue-sqlite.cleanupOld', () => {
  it('удаляет старые published, сохраняет pending', () => {
    const old = q.enqueue(makeItem());
    const recent = q.enqueue(makeItem());
    const pending = q.enqueue(makeItem());

    q.markPublished(old.id, ['p1']);
    q.updateItem(old.id, {
      publishedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    });
    q.markPublished(recent.id, ['p2']);

    const removed = q.cleanupOld({ daysToKeep: 30 });
    expect(removed).toBe(1);
    expect(q.getById(old.id)).toBeNull();
    expect(q.getById(recent.id)).not.toBeNull();
    expect(q.getById(pending.id)).not.toBeNull();
  });

  it('не удаляет свежие записи', () => {
    const e = q.enqueue(makeItem());
    q.markPublished(e.id, ['p1']);
    expect(q.cleanupOld({ daysToKeep: 30 })).toBe(0);
  });

  it('возвращает 0 для пустой БД', () => {
    expect(q.cleanupOld({ daysToKeep: 30 })).toBe(0);
  });
});

describe('queue-sqlite — ACID', () => {
  it('данные сохраняются между "открытиями"', async () => {
    q.enqueue(makeItem({ caption: 'first' }));
    q._closeDb();
    vi.resetModules();
    const q2 = await import('../../agent/queue-sqlite.js');
    const all = q2.getUpcoming({ limit: 10 });
    expect(all).toHaveLength(1);
    expect(all[0].caption).toBe('first');
    q2._closeDb();
  });

  it('WAL mode активен', () => {
    q.enqueue(makeItem());
    q._closeDb();
    const db = new Database(path.join(tmpDir, 'queue.db'));
    const mode = db.pragma('journal_mode', { simple: true });
    db.close();
    expect(mode).toBe('wal');
  });
});
