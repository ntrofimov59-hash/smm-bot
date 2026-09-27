// agent/queue-migrate.js — миграция JSON-очереди в SQLite
import fs from 'fs';
import path from 'path';

const DEFAULT_DATA_DIR = path.resolve(new URL('./data/', import.meta.url).pathname);

function getJsonPath() {
  return path.join(process.env.SMM_DATA_DIR || DEFAULT_DATA_DIR, 'queue.json');
}

/**
 * Переносит все записи из queue.json в queue.db (SQLite).
 * Идемпотентно: повторный запуск ничего не изменит.
 *
 * @param {{ deleteOld?: boolean }} opts
 * @returns {Promise<{ total: number, migrated: number, skipped: number, deletedOld: boolean }>}
 */
export async function migrateJsonToSqlite({ deleteOld = false } = {}) {
  const jsonPath = getJsonPath();
  if (!fs.existsSync(jsonPath)) {
    return { total: 0, migrated: 0, skipped: 0, deletedOld: false };
  }

  const raw = fs.readFileSync(jsonPath, 'utf8');
  const data = JSON.parse(raw);
  const items = Array.isArray(data.items) ? data.items : [];

  // Импортируем SQLite-модуль лениво, чтобы не поднимать БД если миграция не нужна
  const sqlite = await import('./queue-sqlite.js');

  let migrated = 0;
  let skipped = 0;
  for (const item of items) {
    const inserted = sqlite.importItem(item);
    if (inserted) migrated++;
    else skipped++;
  }

  let deletedOld = false;
  if (deleteOld && migrated > 0) {
    fs.renameSync(jsonPath, jsonPath + '.migrated');
    deletedOld = true;
  }

  return { total: items.length, migrated, skipped, deletedOld };
}

/**
 * Возвращает имя активного бэкенда и путь к файлу данных.
 */
export function getQueueInfo() {
  const backend = (process.env.QUEUE_BACKEND || 'json').toLowerCase();
  const dataDir = process.env.SMM_DATA_DIR || DEFAULT_DATA_DIR;
  const file = backend === 'sqlite' ? 'queue.db' : 'queue.json';
  const fullPath = path.join(dataDir, file);
  const exists = fs.existsSync(fullPath);
  let size = 0;
  let count = null;
  if (exists) {
    size = fs.statSync(fullPath).size;
    if (backend === 'json') {
      try {
        count = JSON.parse(fs.readFileSync(fullPath, 'utf8')).items?.length ?? 0;
      } catch { count = null; }
    }
  }
  return { backend, path: fullPath, exists, sizeBytes: size, count };
}
