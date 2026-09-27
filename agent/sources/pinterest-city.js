// agent/sources/pinterest-city.js — скачивание фото для города проекта.
//
// Логика:
//   1. Если у города есть pinterestBoards → качаем с них
//   2. Если boards пусто / ничего не нашли → идём в search по searchQueries
//   3. Скачиваем найденные картинки в destDir (обычно inbox проекта)
//   4. Дедуп: если hash URL уже есть в destDir — пропускаем
//
// Идемпотентно: повторный запуск не создаёт дублей.

import fs from 'fs';
import crypto from 'crypto';
import { fetchPinterestBoard, fetchPinterestSearch } from './pinterest.js';
import { downloadImage } from './downloader.js';
import { getCity, buildSearchQueries } from '../locations.js';

function urlHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/**
 * Возвращает Set из hash'ей URL, уже лежащих в destDir.
 * Имена файлов: `<timestamp>-<hash16>.<ext>`
 */
function listExistingHashes(destDir) {
  const hashes = new Set();
  try {
    const files = fs.readdirSync(destDir);
    for (const f of files) {
      const m = f.match(/-([a-f0-9]{16})\.[a-z]+$/i);
      if (m) hashes.add(m[1]);
    }
  } catch {}
  return hashes;
}

/**
 * Возвращает список { imageUrl, source, sourceUrl, city } для города.
 * Не скачивает — только находит.
 */
export async function fetchCityImages(project, cityKey, opts = {}) {
  const {
    limit = 20,
    fetchImpl = fetch,
    source = 'auto', // 'boards' | 'search' | 'auto'
  } = opts;

  const city = getCity(project, cityKey);
  if (!city) {
    throw new Error(`pinterest-city: город "${cityKey}" не найден в проекте`);
  }

  const results = [];
  const seen = new Set();

  const push = (items) => {
    for (const item of items) {
      if (results.length >= limit) return;
      if (!item.imageUrl || seen.has(item.imageUrl)) continue;
      seen.add(item.imageUrl);
      results.push({ ...item, city: cityKey });
    }
  };

  const boards = Array.isArray(city.pinterestBoards) ? city.pinterestBoards : [];

  // 1. Boards (если есть и source позволяет)
  if ((source === 'auto' || source === 'boards') && boards.length) {
    for (const boardUrl of boards) {
      if (results.length >= limit) break;
      try {
        const items = await fetchPinterestBoard(boardUrl, {
          fetchImpl,
          limit: limit - results.length,
        });
        push(items);
      } catch (e) {
        console.warn(`pinterest-city: board ${boardUrl} failed: ${e.message}`);
      }
    }
  }

  // 2. Search — если boards не дали результата, или явно запрошен search
  const useSearch = source === 'search' || (source === 'auto' && results.length === 0);
  if (useSearch) {
    const queries = buildSearchQueries(project, cityKey, { limit: 5 });
    for (const q of queries) {
      if (results.length >= limit) break;
      try {
        const items = await fetchPinterestSearch(q, {
          fetchImpl,
          limit: limit - results.length,
        });
        push(items);
      } catch (e) {
        console.warn(`pinterest-city: search "${q}" failed: ${e.message}`);
      }
    }
  }

  return results;
}

/**
 * Fetch + download в destDir. Пропускает URL, чей hash уже есть в destDir.
 *
 * @returns {{ downloaded: [], skipped: [], failed: [], found: number }}
 */
export async function fetchCityAndSave(project, cityKey, destDir, opts = {}) {
  const {
    limit = 20,
    fetchImpl = fetch,
    downloadOpts = {},
    onProgress,
  } = opts;

  fs.mkdirSync(destDir, { recursive: true });

  const found = await fetchCityImages(project, cityKey, { limit, fetchImpl });

  const existing = listExistingHashes(destDir);
  const downloaded = [];
  const skipped = [];
  const failed = [];

  for (const item of found) {
    const hash = urlHash(item.imageUrl);
    if (existing.has(hash)) {
      skipped.push({ imageUrl: item.imageUrl, reason: 'already in inbox' });
      continue;
    }

    try {
      const r = await downloadImage(item.imageUrl, destDir, { fetchImpl, ...downloadOpts });
      const enriched = { ...r, sourceMeta: item };
      downloaded.push(enriched);
      existing.add(hash);
      if (onProgress) onProgress(enriched, found.length);
    } catch (e) {
      failed.push({ imageUrl: item.imageUrl, error: e.message });
    }
  }

  return { downloaded, skipped, failed, found: found.length };
}
