import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  mockAnalyzeImage,
  mockGenerateCaption,
  mockProcessImage,
  mockPickBestMatches,
  mockNotifyScheduled,
} = vi.hoisted(() => ({
  mockAnalyzeImage: vi.fn(),
  mockGenerateCaption: vi.fn(),
  mockProcessImage: vi.fn(),
  mockPickBestMatches: vi.fn(),
  mockNotifyScheduled: vi.fn(),
}));

vi.mock('../../agent/vision.js', () => ({ analyzeImage: mockAnalyzeImage }));
vi.mock('../../agent/caption.js', () => ({ generateCaption: mockGenerateCaption }));
vi.mock('../../agent/image-processor.js', () => ({ processImage: mockProcessImage }));
vi.mock('../../agent/matcher.js', () => ({ pickBestMatches: mockPickBestMatches }));
vi.mock('../../agent/telegram.js', () => ({
  notifyScheduled: mockNotifyScheduled,
  notifyPublished: vi.fn(),
  notifyFailed: vi.fn(),
}));

let tmpProjectDir, tmpDataDir, tmpMediaDir;
let sources, scanner;

const PROJECT = {
  slug: 'test-fetch',
  timezone: 'Asia/Yerevan',
  languages: ['ru'],
  publishing: { bestHours: ['11:00'], maxHashtags: 10, minHoursBetweenPosts: 4 },
  hashtags: { base: ['#test'], cities: {} },
};

const ACCOUNTS = {
  instagram: [{
    username: 'acc', igUserId: '1', accessToken: 'tok',
    city: 'phuket', cityTags: ['beach'], active: true,
  }],
};

const BOARD_HTML = `<html>
  <img src="https://i.pinimg.com/736x/aa/bb/cc/photo1.jpg">
  <img src="https://i.pinimg.com/736x/dd/ee/ff/photo2.jpg">
  <img src="https://i.pinimg.com/736x/11/22/33/photo3.jpg">
</html>`;

const FAKE_JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);

/**
 * Универсальный mock fetch:
 * - pinterest.com → отдаёт HTML доски
 * - i.pinimg.com → отдаёт картинку
 */
function makeUniversalFetch() {
  return vi.fn(async (url) => {
    if (url.includes('pinterest.com')) {
      return {
        ok: true,
        status: 200,
        text: async () => BOARD_HTML,
        headers: { get: () => null },
      };
    }
    if (url.includes('i.pinimg.com')) {
      return {
        ok: true,
        status: 200,
        headers: {
          get: (h) => {
            const lc = h.toLowerCase();
            if (lc === 'content-type') return 'image/jpeg';
            if (lc === 'content-length') return String(FAKE_JPEG.length);
            return null;
          },
        },
        arrayBuffer: async () =>
          FAKE_JPEG.buffer.slice(FAKE_JPEG.byteOffset, FAKE_JPEG.byteOffset + FAKE_JPEG.byteLength),
      };
    }
    throw new Error('unexpected url in mock fetch: ' + url);
  });
}

beforeEach(async () => {
  tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-proj-'));
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-data-'));
  tmpMediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-media-'));

  fs.mkdirSync(path.join(tmpProjectDir, 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(tmpProjectDir, 'project.json'), JSON.stringify(PROJECT));
  fs.writeFileSync(path.join(tmpProjectDir, 'accounts.json'), JSON.stringify(ACCOUNTS));

  vi.stubEnv('SMM_DATA_DIR', tmpDataDir);
  vi.stubEnv('MEDIA_DIR', tmpMediaDir);
  vi.stubEnv('MEDIA_PUBLIC_URL', 'https://test.local/media');

  vi.resetModules();
  mockAnalyzeImage.mockReset();
  mockGenerateCaption.mockReset();
  mockProcessImage.mockReset();
  mockPickBestMatches.mockReset();
  mockNotifyScheduled.mockReset();

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  mockAnalyzeImage.mockResolvedValue({
    description: 'beach photo', tags: ['beach', 'ocean'], mood: 'tropical',
    primaryColor: null, hasPeople: false, suggestedTopics: [],
  });
  mockGenerateCaption.mockResolvedValue({
    caption: 'fetched caption', hashtags: ['#test'], tokens: 10,
  });
  mockPickBestMatches.mockReturnValue([
    { username: 'acc', igUserId: '1', accessToken: 'tok', city: 'phuket', _score: 1 },
  ]);
  mockProcessImage.mockImplementation(async (input, output) => {
    fs.copyFileSync(input, output);
    return { width: 100, height: 100, sizeKB: 5 };
  });

  sources = await import('../../agent/sources/index.js');
  scanner = await import('../../agent/scanner.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
  fs.rmSync(tmpMediaDir, { recursive: true, force: true });
});

function listInbox() {
  return fs.readdirSync(path.join(tmpProjectDir, 'inbox'));
}

describe('fetch → inbox → scanner (full pipeline, mock fetch)', () => {
  it('fetchAndSave скачивает 3 пина в inbox', async () => {
    const inboxDir = path.join(tmpProjectDir, 'inbox');
    const fetchImpl = makeUniversalFetch();

    const r = await sources.fetchAndSave(
      'pinterest',
      { boardUrl: 'https://www.pinterest.com/user/board/' },
      inboxDir,
      { limit: 10, fetchImpl },
    );

    expect(r.downloaded).toHaveLength(3);
    expect(r.failed).toHaveLength(0);

    const files = listInbox();
    expect(files).toHaveLength(3);
    // все файлы .jpg
    for (const f of files) expect(f).toMatch(/\.jpg$/);
  });

  it('scanner --dry после fetch видит 3 файла и обрабатывает их', async () => {
    const inboxDir = path.join(tmpProjectDir, 'inbox');
    const fetchImpl = makeUniversalFetch();

    await sources.fetchAndSave(
      'pinterest',
      { boardUrl: 'https://www.pinterest.com/user/board/' },
      inboxDir,
      { fetchImpl },
    );

    const stats = await scanner.scanProject(tmpProjectDir, { dryRun: true });

    expect(stats.scanned).toBe(3);
    expect(stats.processed).toBe(3);
    expect(stats.scheduled).toBe(0);
    expect(stats.failed).toBe(0);

    // dry-run: файлы остались в inbox
    expect(listInbox()).toHaveLength(3);
  });

  it('scanner без dry-run планирует 3 поста и переносит файлы в processed', async () => {
    const inboxDir = path.join(tmpProjectDir, 'inbox');
    const fetchImpl = makeUniversalFetch();

    await sources.fetchAndSave(
      'pinterest',
      { boardUrl: 'https://www.pinterest.com/user/board/' },
      inboxDir,
      { fetchImpl },
    );

    const stats = await scanner.scanProject(tmpProjectDir);

    expect(stats.scanned).toBe(3);
    expect(stats.scheduled).toBe(3);
    expect(stats.failed).toBe(0);

    expect(listInbox()).toHaveLength(0);
    const processed = fs.readdirSync(path.join(tmpProjectDir, 'processed'));
    expect(processed).toHaveLength(3);

    // queue
    const q = JSON.parse(fs.readFileSync(path.join(tmpDataDir, 'queue.json'), 'utf8'));
    expect(q.items).toHaveLength(3);
    for (const item of q.items) {
      expect(item.status).toBe('pending');
      expect(item.projectSlug).toBe('test-fetch');
    }
  });

  it('частичный fetch-фейл: один битый URL — остальные проходят', async () => {
    const inboxDir = path.join(tmpProjectDir, 'inbox');

    // переопределяем fetch: второй пин отдаёт 404
    let pinCounter = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('pinterest.com')) {
        return { ok: true, status: 200, text: async () => BOARD_HTML, headers: { get: () => null } };
      }
      if (url.includes('i.pinimg.com')) {
        pinCounter++;
        if (pinCounter === 2) return { ok: false, status: 404, headers: { get: () => null } };
        return {
          ok: true, status: 200,
          headers: { get: (h) => h.toLowerCase() === 'content-type' ? 'image/jpeg' : null },
          arrayBuffer: async () =>
            FAKE_JPEG.buffer.slice(FAKE_JPEG.byteOffset, FAKE_JPEG.byteOffset + FAKE_JPEG.byteLength),
        };
      }
      throw new Error('unexpected');
    });

    const r = await sources.fetchAndSave(
      'pinterest',
      { boardUrl: 'https://www.pinterest.com/user/board/' },
      inboxDir,
      { fetchImpl },
    );

    expect(r.downloaded).toHaveLength(2);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].error).toContain('HTTP 404');
    expect(listInbox()).toHaveLength(2);
  });
});
