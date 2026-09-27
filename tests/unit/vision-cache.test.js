import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir;
let sampleFile;
let vc;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-'));
  sampleFile = path.join(tmpDir, 'sample.jpg');
  fs.writeFileSync(sampleFile, Buffer.from('fake-image-content'));
  vi.stubEnv('SMM_DATA_DIR', tmpDir);
  vi.resetModules();
  vc = await import('../../agent/vision-cache.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('vision-cache.getCached / setCache', () => {
  it('getCached возвращает null если кэш пуст', () => {
    expect(vc.getCached(sampleFile)).toBeNull();
  });

  it('setCache + getCached = roundtrip', () => {
    vc.setCache(sampleFile, { tags: ['beach'], mood: 'sunny' });
    const r = vc.getCached(sampleFile);
    expect(r.tags).toEqual(['beach']);
    expect(r.mood).toBe('sunny');
    expect(r.cachedAt).toBeTruthy();
  });

  it('кэш привязан к содержимому, а не к имени файла', () => {
    vc.setCache(sampleFile, { tags: ['a'] });
    const renamed = path.join(tmpDir, 'renamed.jpg');
    fs.copyFileSync(sampleFile, renamed);
    const r = vc.getCached(renamed);
    expect(r).not.toBeNull();
    expect(r.tags).toEqual(['a']);
  });

  it('разные файлы → разные ключи', () => {
    const other = path.join(tmpDir, 'other.jpg');
    fs.writeFileSync(other, Buffer.from('different-content'));
    vc.setCache(sampleFile, { tags: ['a'] });
    vc.setCache(other, { tags: ['b'] });
    expect(vc.getCached(sampleFile).tags).toEqual(['a']);
    expect(vc.getCached(other).tags).toEqual(['b']);
  });

  it('getCached возвращает null при битом JSON', () => {
    vc.setCache(sampleFile, { tags: ['a'] });
    const cacheDir = path.join(tmpDir, 'vision-cache');
    const file = fs.readdirSync(cacheDir)[0];
    fs.writeFileSync(path.join(cacheDir, file), 'NOT_JSON');
    expect(vc.getCached(sampleFile)).toBeNull();
  });

  it('getCached возвращает null для несуществующего файла', () => {
    expect(vc.getCached('/nope/missing.jpg')).toBeNull();
  });
});

describe('vision-cache.cacheStats', () => {
  it('возвращает 0 при пустом кэше', () => {
    const s = vc.cacheStats();
    expect(s.entries).toBe(0);
  });

  it('считает количество записей и размер', () => {
    vc.setCache(sampleFile, { tags: ['a'] });
    const other = path.join(tmpDir, 'o.jpg');
    fs.writeFileSync(other, Buffer.from('xyz'));
    vc.setCache(other, { tags: ['b'] });
    const s = vc.cacheStats();
    expect(s.entries).toBe(2);
    expect(s.totalKB).toBeGreaterThanOrEqual(0);
  });
});
