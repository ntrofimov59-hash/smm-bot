// agent/vision-cache.js — кэш результатов vision по SHA256 файла
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DEFAULT_DATA_DIR = path.resolve(new URL('./data/', import.meta.url).pathname);

function getCacheDir() {
  const dir = process.env.SMM_DATA_DIR
    ? path.join(process.env.SMM_DATA_DIR, 'vision-cache')
    : path.join(DEFAULT_DATA_DIR, 'vision-cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileHash(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function cacheKey(filePath) {
  return fileHash(filePath);
}

export function getCached(filePath) {
  try {
    const key = cacheKey(filePath);
    const cachePath = path.join(getCacheDir(), `${key}.json`);
    if (!fs.existsSync(cachePath)) return null;
    const raw = fs.readFileSync(cachePath, 'utf8');
    const data = JSON.parse(raw);
    console.log(`🎯 vision-cache: HIT (${key.slice(0, 12)})`);
    return data;
  } catch (e) {
    console.warn('vision-cache: get failed:', e.message);
    return null;
  }
}

export function setCache(filePath, result) {
  try {
    const key = cacheKey(filePath);
    const cachePath = path.join(getCacheDir(), `${key}.json`);
    fs.writeFileSync(cachePath, JSON.stringify({
      ...result,
      cachedAt: new Date().toISOString(),
    }, null, 2));
    console.log(`💾 vision-cache: STORE (${key.slice(0, 12)})`);
  } catch (e) {
    console.warn('vision-cache: set failed:', e.message);
  }
}

export function cacheStats() {
  try {
    const files = fs.readdirSync(getCacheDir()).filter(f => f.endsWith('.json'));
    let totalBytes = 0;
    for (const f of files) {
      totalBytes += fs.statSync(path.join(getCacheDir(), f)).size;
    }
    return {
      entries: files.length,
      totalKB: Math.round(totalBytes / 1024),
    };
  } catch {
    return { entries: 0, totalKB: 0 };
  }
}
