// agent/sources/downloader.js — безопасное скачивание картинок из источников
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const DEFAULT_TIMEOUT_MS = 20_000;

const ALLOWED_MIME = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

/**
 * Скачивает URL и сохраняет как файл в destDir.
 *
 * Валидации:
 *   - URL должен быть https
 *   - Content-Type должен быть image/*
 *   - фактический размер <= maxBytes
 *   - таймаут через AbortSignal
 *
 * @returns {Promise<{path:string, filename:string, sizeBytes:number, sizeKB:number, contentType:string, sourceUrl:string}>}
 * @throws {Error} на любой шаг валидации
 */
export async function downloadImage(url, destDir, opts = {}) {
  const {
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
  } = opts;

  if (!url || typeof url !== 'string') {
    throw new Error('downloader: url обязателен');
  }
  if (!url.startsWith('https://')) {
    throw new Error('downloader: только https URL');
  }
  if (!destDir) {
    throw new Error('downloader: destDir обязателен');
  }

  fs.mkdirSync(destDir, { recursive: true });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'smm-bot/1.0 (+https://github.com/ntrofimov59-hash/smm-bot)',
        'Accept': 'image/*',
      },
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`downloader: сеть/таймаут: ${e.message}`);
  }

  try {
    if (!res.ok) {
      throw new Error(`downloader: HTTP ${res.status}`);
    }

    const contentType = (res.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_MIME.has(contentType)) {
      throw new Error(`downloader: недопустимый Content-Type: ${contentType || 'unknown'}`);
    }

    const contentLength = Number(res.headers?.get?.('content-length') || 0);
    if (contentLength && contentLength > maxBytes) {
      throw new Error(`downloader: файл слишком большой (Content-Length=${contentLength})`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      throw new Error(`downloader: файл слишком большой (${buf.length} > ${maxBytes})`);
    }
    if (buf.length === 0) {
      throw new Error('downloader: пустой ответ');
    }

    const ext = ALLOWED_MIME.get(contentType);
    const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
    const filename = `${Date.now()}-${hash}${ext}`;
    const fullPath = path.join(destDir, filename);

    fs.writeFileSync(fullPath, buf);

    return {
      path: fullPath,
      filename,
      sizeBytes: buf.length,
      sizeKB: Math.round(buf.length / 1024),
      contentType,
      sourceUrl: url,
    };
  } finally {
    clearTimeout(timer);
  }
}
