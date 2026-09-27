import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir;
let q;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-'));
  vi.stubEnv('SMM_DATA_DIR', tmpDir);
  vi.resetModules();
  q = await import('../../agent/queue.js');
});

afterEach(() => {
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

describe('queue.enqueue', () => {
  it('создаёт запись со status=pending и уникальным id', () => {
    const e = q.enqueue(makeItem());
    expect(e.id).toBeTruthy();
    expect(e.status).toBe('pending');
    expect(e.attempts).toBe(0);
    expect(e.publishedPostIds).toEqual([]);
  });

  it('генерирует разные id для двух записей', () => {
    const a = q.enqueue(makeItem());
    const b = q.enqueue(makeItem());
    expect(a.id).not.toBe(b.id);
  });

  it('сохраняет в файл (персистентность)', () => {
    q.enqueue(makeItem());
    const file = path.join(tmpDir, 'queue.json');
    expect(fs.existsSync(file)).toBe(true);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(data.items).toHaveLength(1);
  });
});

describe('queue.getPending', () => {
  it('возвращает только due-посты', () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const future = new Date(Date.now() + 60000).toISOString();
    q.enqueue(makeItem({ scheduledAt: past }));
    q.enqueue(makeItem({ scheduledAt: future }));
    const p = q.getPending();
    expect(p).toHaveLength(1);
    expect(p[0].scheduledAt).toBe(past);
  });

  it('не возвращает published / failed', () => {
    const e = q.enqueue(makeItem({ scheduledAt: new Date(Date.now() - 1000).toISOString() }));
    q.markPublished(e.id, ['p1']);
    expect(q.getPending()).toHaveLength(0);
  });

  it('поддерживает beforeTime', () => {
    const t1 = new Date(Date.now() + 100000).toISOString();
    q.enqueue(makeItem({ scheduledAt: t1 }));
    const future = Date.now() + 200000;
    expect(q.getPending({ beforeTime: future })).toHaveLength(1);
  });
});

describe('queue.getUpcoming', () => {
  it('сортирует по scheduledAt и соблюдает limit', () => {
    q.enqueue(makeItem({ scheduledAt: new Date(Date.now() + 30000).toISOString() }));
    q.enqueue(makeItem({ scheduledAt: new Date(Date.now() + 10000).toISOString() }));
    q.enqueue(makeItem({ scheduledAt: new Date(Date.now() + 20000).toISOString() }));
    const up = q.getUpcoming({ limit: 2 });
    expect(up).toHaveLength(2);
    expect(new Date(up[0].scheduledAt).getTime()).toBeLessThan(new Date(up[1].scheduledAt).getTime());
  });
});

describe('queue.getStats', () => {
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
});

describe('queue.updateItem', () => {
  it('обновляет поля', () => {
    const e = q.enqueue(makeItem());
    const updated = q.updateItem(e.id, { caption: 'new' });
    expect(updated.caption).toBe('new');
  });

  it('возвращает null для несуществующего id', () => {
    expect(q.updateItem('nope', {})).toBeNull();
  });
});

describe('queue.markPublished', () => {
  it('устанавливает статус и publishedAt', () => {
    const e = q.enqueue(makeItem());
    const p = q.markPublished(e.id, [{ username: 'x', postId: 'p1' }]);
    expect(p.status).toBe('published');
    expect(p.publishedPostIds).toHaveLength(1);
    expect(p.publishedAt).toBeTruthy();
    expect(p.lastError).toBeNull();
  });
});

describe('queue.markFailed', () => {
  it('сохраняет ошибку', () => {
    const e = q.enqueue(makeItem());
    const f = q.markFailed(e.id, 'some error');
    expect(f.status).toBe('failed');
    expect(f.lastError).toBe('some error');
  });

  it('обрезает длинную ошибку до 500 символов', () => {
    const e = q.enqueue(makeItem());
    const f = q.markFailed(e.id, 'x'.repeat(1000));
    expect(f.lastError).toHaveLength(500);
  });
});

describe('queue.incrementAttempts', () => {
  it('инкрементит счётчик попыток', () => {
    const e = q.enqueue(makeItem());
    q.incrementAttempts(e.id);
    q.incrementAttempts(e.id);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'queue.json'), 'utf8'));
    expect(data.items[0].attempts).toBe(2);
  });

  it('игнорирует несуществующий id', () => {
    expect(() => q.incrementAttempts('nope')).not.toThrow();
  });
});

describe('queue.cleanupOld', () => {
  it('удаляет старые published/failed, сохраняет pending', () => {
    const old = q.enqueue(makeItem());
    const recent = q.enqueue(makeItem());
    const pending = q.enqueue(makeItem());
    q.markPublished(old.id, ['p1']);
    q.updateItem(old.id, { publishedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString() });
    q.markPublished(recent.id, ['p2']);

    const removed = q.cleanupOld({ daysToKeep: 30 });
    expect(removed).toBe(1);
    expect(q.getStats().total).toBe(2);
    expect(q.getPending().some(i => i.id === pending.id) || q.getStats().pending === 1).toBe(true);
  });

  it('не удаляет свежие записи', () => {
    const e = q.enqueue(makeItem());
    q.markPublished(e.id, ['p1']);
    expect(q.cleanupOld({ daysToKeep: 30 })).toBe(0);
  });
});
