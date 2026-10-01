// agent/queue-strip-tokens.js — убрать accessToken из существующих записей очереди
import fs from 'fs';
import path from 'path';
import { getBackendName } from './queue.js';
import { stripTokensFromItem } from './accounts-resolver.js';

function dataDir() {
  return process.env.SMM_DATA_DIR
    || path.resolve(path.dirname(new URL(import.meta.url).pathname), 'data');
}

export function stripTokensFromJsonQueue() {
  const file = path.join(dataDir(), 'queue.json');
  if (!fs.existsSync(file)) {
    return { ok: true, stripped: 0, message: 'queue.json нет' };
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = Array.isArray(raw) ? raw : (raw.items || []);
  let stripped = 0;
  for (let i = 0; i < items.length; i++) {
    const before = JSON.stringify(items[i].accounts || []);
    items[i] = stripTokensFromItem(items[i]);
    const after = JSON.stringify(items[i].accounts || []);
    if (before !== after) stripped++;
  }
  const out = Array.isArray(raw) ? items : { ...raw, items };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, file);
  return { ok: true, stripped, total: items.length, file };
}

export async function stripTokensAll() {
  const backend = getBackendName();
  if (backend === 'json') return stripTokensFromJsonQueue();
  // sqlite: обновим через better-sqlite3 напрямую
  const Database = (await import('better-sqlite3')).default;
  const dbPath = path.join(dataDir(), 'queue.db');
  if (!fs.existsSync(dbPath)) return { ok: true, stripped: 0, message: 'queue.db нет' };
  const db = new Database(dbPath);
  const rows = db.prepare('SELECT id, data FROM queue_items').all();
  let stripped = 0;
  const upd = db.prepare('UPDATE queue_items SET data = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const row of rows) {
      let item;
      try { item = JSON.parse(row.data); } catch { continue; }
      const next = stripTokensFromItem(item);
      if (JSON.stringify(item.accounts) !== JSON.stringify(next.accounts)) {
        upd.run(JSON.stringify(next), row.id);
        stripped++;
      }
    }
  });
  tx();
  db.close();
  return { ok: true, stripped, total: rows.length, file: dbPath };
}
