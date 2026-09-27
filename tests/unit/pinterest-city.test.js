import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const {
  mockFetchBoard,
  mockFetchSearch,
  mockDownload,
} = vi.hoisted(() => ({
  mockFetchBoard: vi.fn(),
  mockFetchSearch: vi.fn(),
  mockDownload: vi.fn(),
}));

vi.mock('../../agent/sources/pinterest.js', () => ({
  fetchPinterestBoard: mockFetchBoard,
  fetchPinterestSearch: mockFetchSearch,
}));

vi.mock('../../agent/sources/downloader.js', () => ({
  downloadImage: mockDownload,
}));

let cityMod;
let tmpDir;

const project = {
  cities: {
    phuket: {
      displayName: 'Phuket',
      country: 'Thailand',
      tags: ['beach'],
      hashtags: [],
      landmarks: [],
      nearby: [],
      searchQueries: ['phuket beach', 'phuket sunset'],
      pinterestBoards: [],
    },
    bali: {
      displayName: 'Bali',
      tags: ['beach'],
      searchQueries: ['bali beach'],
      pinterestBoards: ['https://www.pinterest.com/user/bali-board/'],
    },
  },
};

const pin = (n) => ({ imageUrl: 'https://i.pinimg.com/736x/aa/bb/' + n + '.jpg', sourceId: null });

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcity-'));
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mockFetchBoard.mockReset();
  mockFetchSearch.mockReset();
  mockDownload.mockReset();
  cityMod = await import('../../agent/sources/pinterest-city.js');
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('pinterest-city.fetchCityImages', () => {
  it('throws for unknown city', async () => {
    await expect(cityMod.fetchCityImages(project, 'nowhere')).rejects.toThrow(/не найден/);
  });

  it('uses search when no boards', async () => {
    mockFetchSearch
      .mockResolvedValueOnce([pin(1), pin(2)])
      .mockResolvedValueOnce([pin(3)]);
    const r = await cityMod.fetchCityImages(project, 'phuket', { limit: 10 });
    expect(r).toHaveLength(3);
    expect(mockFetchSearch).toHaveBeenCalledTimes(2);
    expect(mockFetchBoard).not.toHaveBeenCalled();
    expect(r[0].city).toBe('phuket');
  });

  it('uses boards when present', async () => {
    mockFetchBoard.mockResolvedValueOnce([pin(1), pin(2)]);
    const r = await cityMod.fetchCityImages(project, 'bali', { limit: 10 });
    expect(r).toHaveLength(2);
    expect(mockFetchBoard).toHaveBeenCalledWith(
      'https://www.pinterest.com/user/bali-board/',
      expect.any(Object),
    );
    expect(mockFetchSearch).not.toHaveBeenCalled();
  });

  it('falls back to search when boards return empty', async () => {
    mockFetchBoard.mockResolvedValueOnce([]);
    mockFetchSearch.mockResolvedValueOnce([pin(1)]);
    const r = await cityMod.fetchCityImages(project, 'bali', { limit: 10 });
    expect(r).toHaveLength(1);
    expect(mockFetchSearch).toHaveBeenCalledTimes(1);
  });

  it('source=search skips boards', async () => {
    mockFetchSearch.mockResolvedValueOnce([pin(1)]);
    await cityMod.fetchCityImages(project, 'bali', { source: 'search' });
    expect(mockFetchBoard).not.toHaveBeenCalled();
  });

  it('source=boards skips search', async () => {
    mockFetchBoard.mockResolvedValueOnce([]);
    await cityMod.fetchCityImages(project, 'bali', { source: 'boards' });
    expect(mockFetchSearch).not.toHaveBeenCalled();
  });

  it('respects limit', async () => {
    mockFetchSearch.mockResolvedValue([pin(1), pin(2), pin(3), pin(4), pin(5)]);
    const r = await cityMod.fetchCityImages(project, 'phuket', { limit: 2 });
    expect(r).toHaveLength(2);
  });

  it('dedupes same imageUrl across queries', async () => {
    mockFetchSearch
      .mockResolvedValueOnce([pin(1), pin(2)])
      .mockResolvedValueOnce([pin(2), pin(3)]);
    const r = await cityMod.fetchCityImages(project, 'phuket', { limit: 10 });
    expect(r).toHaveLength(3);
  });

  it('continues when one board fails', async () => {
    const projectTwoBoards = {
      cities: {
        multi: {
          displayName: 'Multi',
          tags: [],
          searchQueries: [],
          pinterestBoards: [
            'https://www.pinterest.com/u/board1/',
            'https://www.pinterest.com/u/board2/',
          ],
        },
      },
    };
    mockFetchBoard
      .mockRejectedValueOnce(new Error('HTTP 404'))
      .mockResolvedValueOnce([pin(1)]);
    const r = await cityMod.fetchCityImages(projectTwoBoards, 'multi', { source: 'boards' });
    expect(r).toHaveLength(1);
  });

  it('continues when one search fails', async () => {
    mockFetchSearch
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce([pin(1)]);
    const r = await cityMod.fetchCityImages(project, 'phuket');
    expect(r).toHaveLength(1);
  });
});

describe('pinterest-city.fetchCityAndSave', () => {
  const fakeDownload = (url) => Promise.resolve({
    path: '/tmp/x', filename: 'x.jpg', sizeBytes: 100, sizeKB: 0,
    contentType: 'image/jpeg', sourceUrl: url,
  });

  it('downloads found images', async () => {
    mockFetchSearch.mockResolvedValueOnce([pin(1), pin(2)]);
    mockDownload.mockImplementation((url) => fakeDownload(url));
    const r = await cityMod.fetchCityAndSave(project, 'phuket', tmpDir, { limit: 10 });
    expect(r.downloaded).toHaveLength(2);
    expect(r.failed).toHaveLength(0);
    expect(mockDownload).toHaveBeenCalledTimes(2);
  });

  it('skips URLs whose hash already in inbox', async () => {
    const hash = crypto.createHash('sha256')
      .update(pin(1).imageUrl).digest('hex').slice(0, 16);
    fs.writeFileSync(path.join(tmpDir, '1700000000000-' + hash + '.jpg'), 'dummy');

    mockFetchSearch.mockResolvedValueOnce([pin(1), pin(2)]);
    mockDownload.mockImplementation((url) => fakeDownload(url));

    const r = await cityMod.fetchCityAndSave(project, 'phuket', tmpDir, { limit: 10 });
    expect(r.skipped).toHaveLength(1);
    expect(r.downloaded).toHaveLength(1);
    expect(mockDownload).toHaveBeenCalledTimes(1);
  });

  it('keeps going after per-file download error', async () => {
    mockFetchSearch.mockResolvedValueOnce([pin(1), pin(2), pin(3)]);
    mockDownload
      .mockResolvedValueOnce(await fakeDownload(pin(1).imageUrl))
      .mockRejectedValueOnce(new Error('HTTP 404'))
      .mockResolvedValueOnce(await fakeDownload(pin(3).imageUrl));

    const r = await cityMod.fetchCityAndSave(project, 'phuket', tmpDir, { limit: 10 });
    expect(r.downloaded).toHaveLength(2);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].error).toBe('HTTP 404');
  });

  it('creates destDir if missing', async () => {
    const newDir = path.join(tmpDir, 'nested', 'inbox');
    mockFetchSearch.mockResolvedValueOnce([pin(1)]);
    mockDownload.mockImplementation((url) => fakeDownload(url));
    await cityMod.fetchCityAndSave(project, 'phuket', newDir, { limit: 10 });
    expect(fs.existsSync(newDir)).toBe(true);
  });

  it('calls onProgress', async () => {
    mockFetchSearch.mockResolvedValueOnce([pin(1), pin(2)]);
    mockDownload.mockImplementation((url) => fakeDownload(url));
    const progress = vi.fn();
    await cityMod.fetchCityAndSave(project, 'phuket', tmpDir, {
      limit: 10, onProgress: progress,
    });
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it('returns found count', async () => {
    mockFetchSearch.mockResolvedValueOnce([pin(1), pin(2), pin(3)]);
    mockDownload.mockImplementation((url) => fakeDownload(url));
    const r = await cityMod.fetchCityAndSave(project, 'phuket', tmpDir, { limit: 10 });
    expect(r.found).toBe(3);
  });
});
