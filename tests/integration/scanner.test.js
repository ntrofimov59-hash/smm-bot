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

let scanner;
let tmpDataDir, tmpMediaDir, tmpProjectDir;
let sampleImage;

const PROJECT = {
  slug: 'test-project',
  timezone: 'Asia/Yerevan',
  languages: ['ru'],
  publishing: { bestHours: ['11:00', '19:00'], maxHashtags: 12, minHoursBetweenPosts: 4 },
  hashtags: { base: ['#test'], cities: { phuket: ['#phuket', '#thailand'] } },
};

const ACCOUNTS = {
  instagram: [{
    username: 'test_acc', igUserId: '1', accessToken: 'tok',
    city: 'phuket', cityTags: ['beach', 'ocean'], active: true,
  }],
};

function writeInbox(filename = 'photo.jpg') {
  fs.copyFileSync(sampleImage, path.join(tmpProjectDir, 'inbox', filename));
}

function readQueue() {
  const file = path.join(tmpDataDir, 'queue.json');
  if (!fs.existsSync(file)) return { items: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

beforeEach(async () => {
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smm-data-'));
  tmpMediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smm-media-'));
  tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smm-proj-'));
  sampleImage = path.join(process.cwd(), 'tests/fixtures/sample.jpg');

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

  // Defaults — всё ок
  mockAnalyzeImage.mockResolvedValue({
    description: 'beach sunset', tags: ['beach', 'ocean'],
    mood: 'tropical', primaryColor: '#FFAA00', hasPeople: false,
    suggestedTopics: ['summer'],
  });
  mockGenerateCaption.mockResolvedValue({
    caption: 'Hello from test', hashtags: ['#test'], tokens: 42,
  });
  mockPickBestMatches.mockReturnValue([
    { username: 'test_acc', igUserId: '1', accessToken: 'tok', city: 'phuket', _score: 1 },
  ]);
  mockProcessImage.mockImplementation(async (input, output) => {
    fs.copyFileSync(input, output);
    return { width: 1080, height: 1080, sizeKB: 100 };
  });

  scanner = await import('../../agent/scanner.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
  fs.rmSync(tmpMediaDir, { recursive: true, force: true });
  fs.rmSync(tmpProjectDir, { recursive: true, force: true });
});

describe('scanner.scanProject — empty inbox', () => {
  it('возвращает нулевую статистику', async () => {
    const r = await scanner.scanProject(tmpProjectDir);
    expect(r).toEqual({ scanned: 0, processed: 0, failed: 0, scheduled: 0 });
    expect(mockAnalyzeImage).not.toHaveBeenCalled();
  });
});

describe('scanner.scanProject — dry-run', () => {
  it('не пишет в queue, не переносит файл, но гоняет весь pipeline', async () => {
    writeInbox('photo.jpg');
    const r = await scanner.scanProject(tmpProjectDir, { dryRun: true });

    expect(r.scanned).toBe(1);
    expect(r.processed).toBe(1);
    expect(r.failed).toBe(0);
    expect(r.scheduled).toBe(0);

    // pipeline прогнан
    expect(mockAnalyzeImage).toHaveBeenCalledOnce();
    expect(mockGenerateCaption).toHaveBeenCalledOnce();
    expect(mockProcessImage).toHaveBeenCalledOnce();

    // файл остался в inbox
    expect(fs.existsSync(path.join(tmpProjectDir, 'inbox', 'photo.jpg'))).toBe(true);
    // queue пуст
    expect(readQueue().items).toHaveLength(0);
    // telegram не вызывался
    expect(mockNotifyScheduled).not.toHaveBeenCalled();
  });
});

describe('scanner.scanProject — happy path', () => {
  it('планирует пост, переносит в processed, пишет в queue', async () => {
    writeInbox('photo.jpg');
    const r = await scanner.scanProject(tmpProjectDir);

    expect(r.scanned).toBe(1);
    expect(r.scheduled).toBe(1);
    expect(r.failed).toBe(0);

    // файл в processed
    expect(fs.existsSync(path.join(tmpProjectDir, 'inbox', 'photo.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(tmpProjectDir, 'processed', 'photo.jpg'))).toBe(true);

    // queue содержит запись
    const q = readQueue();
    expect(q.items).toHaveLength(1);
    expect(q.items[0].status).toBe('pending');
    expect(q.items[0].projectSlug).toBe('test-project');
    expect(q.items[0].caption).toContain('Hello from test');
    expect(q.items[0].accounts[0].username).toBe('test_acc');
    expect(q.items[0].imageUrl).toMatch(/^https:\/\/test\.local\/media\/scheduled\//);
  });

  it('вызывает notifyScheduled после успешного планирования', async () => {
    writeInbox('photo.jpg');
    await scanner.scanProject(tmpProjectDir);

    expect(mockNotifyScheduled).toHaveBeenCalledOnce();
    const arg = mockNotifyScheduled.mock.calls[0][0];
    expect(arg.projectSlug).toBe('test-project');
    expect(arg.count).toBe(1);
    expect(arg.nextTime).toBeTruthy();
  });

  it('scheduledAt в будущем', async () => {
    writeInbox('photo.jpg');
    await scanner.scanProject(tmpProjectDir);
    const scheduled = new Date(readQueue().items[0].scheduledAt).getTime();
    expect(scheduled).toBeGreaterThan(Date.now());
  });

  it('обрабатывает несколько файлов', async () => {
    writeInbox('a.jpg');
    writeInbox('b.jpg');
    writeInbox('c.jpg');
    const r = await scanner.scanProject(tmpProjectDir);
    expect(r.scanned).toBe(3);
    expect(r.scheduled).toBe(3);
    expect(readQueue().items).toHaveLength(3);
  });

  it('игнорирует неподдерживаемые расширения', async () => {
    writeInbox('photo.txt');
    writeInbox('photo.jpg');
    const r = await scanner.scanProject(tmpProjectDir);
    expect(r.scanned).toBe(1);
  });
});

describe('scanner.scanProject — failures', () => {
  it('файл в failed/ когда нет подходящих аккаунтов', async () => {
    mockPickBestMatches.mockReturnValueOnce([]);
    writeInbox('photo.jpg');
    const r = await scanner.scanProject(tmpProjectDir);

    expect(r.failed).toBe(1);
    expect(r.scheduled).toBe(0);

    const failedFiles = fs.readdirSync(path.join(tmpProjectDir, 'failed'));
    expect(failedFiles.some(f => f.endsWith('.jpg'))).toBe(true);
    const errFile = failedFiles.find(f => f.endsWith('.error.txt'));
    expect(fs.readFileSync(path.join(tmpProjectDir, 'failed', errFile), 'utf8'))
      .toContain('no matching accounts');
  });

  it('файл в failed/ когда vision падает', async () => {
    mockAnalyzeImage.mockRejectedValueOnce(new Error('vision down'));
    writeInbox('photo.jpg');
    const r = await scanner.scanProject(tmpProjectDir);

    expect(r.failed).toBe(1);
    const errFile = fs.readdirSync(path.join(tmpProjectDir, 'failed'))
      .find(f => f.endsWith('.error.txt'));
    expect(fs.readFileSync(path.join(tmpProjectDir, 'failed', errFile), 'utf8'))
      .toContain('vision down');
  });

  it('файл в failed/ когда caption падает', async () => {
    mockGenerateCaption.mockRejectedValueOnce(new Error('caption error'));
    writeInbox('photo.jpg');
    const r = await scanner.scanProject(tmpProjectDir);

    expect(r.failed).toBe(1);
    expect(r.scheduled).toBe(0);
    expect(readQueue().items).toHaveLength(0);
  });

  it('не падает весь scan если упал один файл', async () => {
    writeInbox('good.jpg');
    writeInbox('bad.jpg');
    mockAnalyzeImage
      .mockRejectedValueOnce(new Error('first bad'))  // bad.jpg первый по порядку
      .mockResolvedValueOnce({
        description: 'ok', tags: ['beach'], mood: 'x',
        primaryColor: null, hasPeople: false, suggestedTopics: [],
      });

    const r = await scanner.scanProject(tmpProjectDir);
    expect(r.scanned).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.scheduled).toBe(1);
  });
});

describe('scanner.scanProject — missing config', () => {
  it('возвращает нули если нет project.json', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
    const r = await scanner.scanProject(emptyDir);
    expect(r).toEqual({ scanned: 0, processed: 0, failed: 0, scheduled: 0 });
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
