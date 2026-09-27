// agent/queue.js — очередь запланированных и опубликованных постов
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(new URL('./data/', import.meta.url).pathname);
fs.mkdirSync(DATA_DIR, { recursive: true });

const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');

function load() {
  try {
    if (fs.existsSync(QUEUE_FILE)) return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  } catch (e) { console.warn('queue: load failed:', e.message); }
  return { items: [] };
}

function save(data) {
  try {
    const tmp = QUEUE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, QUEUE_FILE);
  } catch (e) { console.error('queue: save failed:', e.message); }
}

/**
 * Добавляет пост в очередь.
 * @returns {Object} — item с id
 */
export function enqueue(item) {
  const data = load();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = {
    id,
    status: 'pending', // pending | publishing | published | failed
    createdAt: new Date().toISOString(),
    scheduledAt: item.scheduledAt, // ISO timestamp
    projectSlug: item.projectSlug,
    projectPath: item.projectPath,
    imagePath: item.imagePath,
    imageUrl: item.imageUrl,
    accounts: item.accounts, // [{username, igUserId, accessToken, city}]
    caption: item.caption,
    hashtags: item.hashtags,
    visionTags: item.visionTags || [],
    attempts: 0,
    lastError: null,
    publishedAt: null,
    publishedPostIds: [],
  };
  data.items.push(entry);
  save(data);
  return entry;
}

export function getPending({ beforeTime } = {}) {
  const data = load();
  const now = beforeTime || Date.now();
  return data.items.filter(i =>
    i.status === 'pending' &&
    new Date(i.scheduledAt).getTime() <= now
  );
}

export function getUpcoming({ limit = 20 } = {}) {
  const data = load();
  return data.items
    .filter(i => i.status === 'pending')
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
    .slice(0, limit);
}

export function getStats() {
  const data = load();
  const stats = { pending: 0, publishing: 0, published: 0, failed: 0, total: data.items.length };
  for (const i of data.items) stats[i.status] = (stats[i.status] || 0) + 1;
  return stats;
}

export function updateItem(id, patch) {
  const data = load();
  const idx = data.items.findIndex(i => i.id === id);
  if (idx === -1) return null;
  data.items[idx] = { ...data.items[idx], ...patch };
  save(data);
  return data.items[idx];
}

export function markPublished(id, postIds) {
  return updateItem(id, {
    status: 'published',
    publishedAt: new Date().toISOString(),
    publishedPostIds: postIds,
    lastError: null,
  });
}

export function markFailed(id, error) {
  return updateItem(id, {
    status: 'failed',
    lastError: String(error).slice(0, 500),
  });
}

export function incrementAttempts(id) {
  const data = load();
  const idx = data.items.findIndex(i => i.id === id);
  if (idx === -1) return;
  data.items[idx].attempts = (data.items[idx].attempts || 0) + 1;
  save(data);
}

export function cleanupOld({ daysToKeep = 30 } = {}) {
  const data = load();
  const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
  const before = data.items.length;
  data.items = data.items.filter(i => {
    if (i.status === 'pending' || i.status === 'publishing') return true;
    const ts = new Date(i.publishedAt || i.createdAt).getTime();
    return ts > cutoff;
  });
  const removed = before - data.items.length;
  if (removed) {
    save(data);
    console.log(`🧹 queue: удалено ${removed} старых записей`);
  }
  return removed;
}
