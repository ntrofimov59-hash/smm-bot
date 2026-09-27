// agent/queue-sqlite.js — очередь на SQLite (better-sqlite3)
// API совместим с agent/queue.js (JSON), чтобы переключаться через QUEUE_BACKEND.

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const DEFAULT_DATA_DIR = path.resolve(new URL('./data/', import.meta.url).pathname);

function getDataDir() {
  return process.env.SMM_DATA_DIR || DEFAULT_DATA_DIR;
}

function getDbPath() {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'queue.db');
}

let _db;

function getDb() {
  if (_db) return _db;
  const db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      project_slug TEXT,
      project_path TEXT,
      image_path TEXT,
      image_url TEXT,
      accounts_json TEXT NOT NULL,
      caption TEXT,
      hashtags_json TEXT,
      vision_tags_json TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      published_at TEXT,
      published_post_ids_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_status ON items(status);
    CREATE INDEX IF NOT EXISTS idx_scheduled ON items(scheduled_at);
  `);
  _db = db;
  return db;
}

export function _closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function rowToItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    scheduledAt: row.scheduled_at,
    projectSlug: row.project_slug,
    projectPath: row.project_path,
    imagePath: row.image_path,
    imageUrl: row.image_url,
    accounts: JSON.parse(row.accounts_json),
    caption: row.caption,
    hashtags: JSON.parse(row.hashtags_json || '[]'),
    visionTags: JSON.parse(row.vision_tags_json || '[]'),
    attempts: row.attempts,
    lastError: row.last_error,
    publishedAt: row.published_at,
    publishedPostIds: JSON.parse(row.published_post_ids_json || '[]'),
  };
}

export function enqueue(item) {
  const db = getDb();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO items (
      id, status, created_at, scheduled_at,
      project_slug, project_path, image_path, image_url,
      accounts_json, caption, hashtags_json, vision_tags_json,
      attempts, last_error, published_at, published_post_ids_json
    ) VALUES (
      @id, @status, @createdAt, @scheduledAt,
      @projectSlug, @projectPath, @imagePath, @imageUrl,
      @accountsJson, @caption, @hashtagsJson, @visionTagsJson,
      0, NULL, NULL, '[]'
    )
  `).run({
    id,
    status: 'pending',
    createdAt,
    scheduledAt: item.scheduledAt,
    projectSlug: item.projectSlug || null,
    projectPath: item.projectPath || null,
    imagePath: item.imagePath || null,
    imageUrl: item.imageUrl || null,
    accountsJson: JSON.stringify(item.accounts || []),
    caption: item.caption || null,
    hashtagsJson: JSON.stringify(item.hashtags || []),
    visionTagsJson: JSON.stringify(item.visionTags || []),
  });

  return getById(id);
}

export function getById(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  return rowToItem(row);
}

export function getPending({ beforeTime } = {}) {
  const db = getDb();
  const iso = new Date(beforeTime || Date.now()).toISOString();
  const rows = db.prepare(
    'SELECT * FROM items WHERE status = ? AND scheduled_at <= ? ORDER BY scheduled_at'
  ).all('pending', iso);
  return rows.map(rowToItem);
}

export function getUpcoming({ limit = 20 } = {}) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM items WHERE status = ? ORDER BY scheduled_at LIMIT ?'
  ).all('pending', limit);
  return rows.map(rowToItem);
}

export function getStats() {
  const db = getDb();
  const rows = db.prepare('SELECT status, COUNT(*) as n FROM items GROUP BY status').all();
  const stats = { pending: 0, publishing: 0, published: 0, failed: 0, total: 0 };
  for (const r of rows) {
    stats[r.status] = r.n;
    stats.total += r.n;
  }
  return stats;
}

export function updateItem(id, patch) {
  const db = getDb();
  const fields = [];
  const params = { id };

  const map = {
    status: 'status',
    caption: 'caption',
    imagePath: 'image_path',
    imageUrl: 'image_url',
    lastError: 'last_error',
    publishedAt: 'published_at',
    projectSlug: 'project_slug',
  };

  for (const [key, col] of Object.entries(map)) {
    if (patch[key] !== undefined) {
      fields.push(`${col} = @${key}`);
      params[key] = patch[key];
    }
  }
  if (patch.accounts !== undefined) {
    fields.push('accounts_json = @accountsJson');
    params.accountsJson = JSON.stringify(patch.accounts);
  }
  if (patch.hashtags !== undefined) {
    fields.push('hashtags_json = @hashtagsJson');
    params.hashtagsJson = JSON.stringify(patch.hashtags);
  }
  if (patch.publishedPostIds !== undefined) {
    fields.push('published_post_ids_json = @ppidsJson');
    params.ppidsJson = JSON.stringify(patch.publishedPostIds);
  }

  if (!fields.length) return getById(id);

  db.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = @id`).run(params);
  return getById(id);
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
  const db = getDb();
  db.prepare('UPDATE items SET attempts = attempts + 1 WHERE id = ?').run(id);
}

export function cleanupOld({ daysToKeep = 30 } = {}) {
  const db = getDb();
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
  const info = db.prepare(`
    DELETE FROM items
    WHERE status NOT IN ('pending', 'publishing')
      AND COALESCE(published_at, created_at) < ?
  `).run(cutoff);
  if (info.changes > 0) {
    console.log(`🧹 queue-sqlite: удалено ${info.changes} старых записей`);
  }
  return info.changes;
}
