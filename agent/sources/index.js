// agent/sources/index.js — диспетчер источников + fetch → download → inbox
import { downloadImage } from './downloader.js';
import { fetchPinterestBoard } from './pinterest.js';
import { fetchOwnMedia, fetchUserMedia } from './instagram-graph.js';

const SUPPORTED = new Set(['pinterest', 'instagram-graph', 'instagram-user']);

/**
 * Возвращает список { imageUrl, source, sourceId?, sourceUrl? } из источника.
 *
 * @param {string} source — 'pinterest' | 'instagram-graph' | 'instagram-user'
 * @param {Object} params — параметры источника
 * @param {Object} [opts] — fetchImpl, limit, timeoutMs
 */
export async function fetchContent(source, params = {}, opts = {}) {
  if (!SUPPORTED.has(source)) {
    throw new Error(`sources: неизвестный источник "${source}" (доступны: ${[...SUPPORTED].join(', ')})`);
  }

  if (source === 'pinterest') {
    if (!params.boardUrl) throw new Error('sources/pinterest: нужен boardUrl');
    return fetchPinterestBoard(params.boardUrl, opts);
  }

  if (source === 'instagram-graph') {
    if (!params.accessToken) throw new Error('sources/instagram-graph: нужен accessToken');
    const media = await fetchOwnMedia({ accessToken: params.accessToken, ...opts });
    // приводим к единой форме { imageUrl }
    return media.map(m => ({
      imageUrl: m.mediaUrl,
      sourceId: m.id,
      source: 'instagram-graph',
      sourceUrl: m.permalink,
      caption: m.caption,
      timestamp: m.timestamp,
    }));
  }

  if (source === 'instagram-user') {
    if (!params.igUserId || !params.accessToken) {
      throw new Error('sources/instagram-user: нужны igUserId и accessToken');
    }
    const media = await fetchUserMedia({
      igUserId: params.igUserId,
      accessToken: params.accessToken,
      ...opts,
    });
    return media.map(m => ({
      imageUrl: m.mediaUrl,
      sourceId: m.id,
      source: 'instagram-user',
      sourceUrl: m.permalink,
      caption: m.caption,
      timestamp: m.timestamp,
    }));
  }
}

/**
 * Скачивает найденные картинки в destDir (обычно inbox проекта).
 * Возвращает { downloaded: [...], failed: [...], skipped: n }
 * Если downloadImage падает на одном URL — не валит всё, копит в failed.
 */
export async function fetchAndSave(source, params, destDir, opts = {}) {
  const { limit = 20, fetchImpl, downloadOpts = {}, onProgress } = opts;

  const found = await fetchContent(source, params, { limit, fetchImpl });
  const downloaded = [];
  const failed = [];

  for (const item of found) {
    try {
      const r = await downloadImage(item.imageUrl, destDir, {
        fetchImpl,
        ...downloadOpts,
      });
      const enriched = { ...r, sourceMeta: item };
      downloaded.push(enriched);
      if (onProgress) onProgress(enriched, found.length);
    } catch (e) {
      failed.push({ imageUrl: item.imageUrl, error: e.message });
    }
  }

  return { downloaded, failed, skipped: found.length - downloaded.length - failed.length };
}
