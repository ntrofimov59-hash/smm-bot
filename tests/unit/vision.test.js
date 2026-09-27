import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  mockGeminiGenerate,
  mockGroqCreate,
  mockGetCached,
  mockSetCache,
  mockCanCallGemini,
  mockTrackGemini,
  mockTrackCacheHit,
} = vi.hoisted(() => ({
  mockGeminiGenerate: vi.fn(),
  mockGroqCreate: vi.fn(),
  mockGetCached: vi.fn(),
  mockSetCache: vi.fn(),
  mockCanCallGemini: vi.fn(() => ({ ok: true })),
  mockTrackGemini: vi.fn(),
  mockTrackCacheHit: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = { generateContent: mockGeminiGenerate };
    }
  },
}));

vi.mock('openai', () => ({
  default: class {
    constructor() {
      this.chat = { completions: { create: mockGroqCreate } };
    }
  },
}));

vi.mock('../../agent/vision-cache.js', () => ({
  getCached: mockGetCached,
  setCache: mockSetCache,
}));

vi.mock('../../agent/usage.js', () => ({
  canCallGemini: mockCanCallGemini,
  trackGemini: mockTrackGemini,
  trackCacheHit: mockTrackCacheHit,
}));

let vision;
let tmpDir;
let imagePath;

const VALID_JSON = JSON.stringify({
  description: 'A beautiful beach',
  tags: ['beach', 'sunset'],
  mood: 'tropical',
  primary_color: '#FFAA00',
  has_people: false,
  suggested_topics: ['summer', 'travel'],
});

function geminiOk(json = VALID_JSON) {
  mockGeminiGenerate.mockResolvedValueOnce({ text: json });
}

function groqOk(json = VALID_JSON) {
  mockGroqCreate.mockResolvedValueOnce({
    choices: [{ message: { content: json } }],
  });
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-'));
  imagePath = path.join(tmpDir, 'test.jpg');
  fs.writeFileSync(imagePath, Buffer.from('fake-jpeg-content'));

  vi.resetModules();
  mockGeminiGenerate.mockReset();
  mockGroqCreate.mockReset();
  mockGetCached.mockReset().mockReturnValue(null);
  mockSetCache.mockReset();
  mockCanCallGemini.mockReset().mockReturnValue({ ok: true });
  mockTrackGemini.mockReset();
  mockTrackCacheHit.mockReset();

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  vision = await import('../../agent/vision.js');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('vision.analyzeImage — cache', () => {
  it('returns cached result and does not call providers', async () => {
    mockGetCached.mockReturnValueOnce({ description: 'cached', tags: ['a'] });
    const r = await vision.analyzeImage(imagePath);
    expect(r.description).toBe('cached');
    expect(r._fromCache).toBe(true);
    expect(mockTrackCacheHit).toHaveBeenCalled();
    expect(mockGeminiGenerate).not.toHaveBeenCalled();
    expect(mockGroqCreate).not.toHaveBeenCalled();
  });

  it('skips cache when useCache:false', async () => {
    mockGetCached.mockReturnValueOnce({ description: 'cached' });
    geminiOk();
    const r = await vision.analyzeImage(imagePath, { useCache: false });
    expect(r._fromCache).toBe(false);
    expect(mockGetCached).not.toHaveBeenCalled();
  });
});

describe('vision.analyzeImage — Gemini provider', () => {
  it('returns normalized result and writes cache', async () => {
    geminiOk();
    const r = await vision.analyzeImage(imagePath);
    expect(r.description).toBe('A beautiful beach');
    expect(r.tags).toEqual(['beach', 'sunset']);
    expect(r.mood).toBe('tropical');
    expect(r.primaryColor).toBe('#FFAA00');
    expect(r.hasPeople).toBe(false);
    expect(r.suggestedTopics).toEqual(['summer', 'travel']);
    expect(r._fromCache).toBe(false);
    expect(mockSetCache).toHaveBeenCalledWith(imagePath, expect.any(Object));
  });

  it('tracks Gemini usage on each call', async () => {
    geminiOk();
    await vision.analyzeImage(imagePath);
    expect(mockTrackGemini).toHaveBeenCalledTimes(1);
  });

  it('strips markdown code fences from Gemini JSON', async () => {
    geminiOk('```json\n' + VALID_JSON + '\n```');
    const r = await vision.analyzeImage(imagePath);
    expect(r.description).toBe('A beautiful beach');
  });

  it('falls back to Groq when Gemini returns invalid JSON', async () => {
    mockGeminiGenerate.mockResolvedValueOnce({ text: 'not-json-at-all' });
    groqOk();
    const r = await vision.analyzeImage(imagePath);
    expect(r.description).toBe('A beautiful beach');
    expect(mockGroqCreate).toHaveBeenCalled();
  });
});

describe('vision.analyzeImage — Groq fallback', () => {
  it('uses Groq when provider:groq explicitly', async () => {
    groqOk();
    const r = await vision.analyzeImage(imagePath, { provider: 'groq' });
    expect(r.description).toBe('A beautiful beach');
    expect(mockGeminiGenerate).not.toHaveBeenCalled();
  });

  it('skips Gemini when limit is exhausted and uses Groq', async () => {
    mockCanCallGemini.mockReturnValueOnce({ ok: false, reason: 'gemini_day_limit' });
    groqOk();
    const r = await vision.analyzeImage(imagePath);
    expect(r.description).toBe('A beautiful beach');
    expect(mockGeminiGenerate).not.toHaveBeenCalled();
    expect(mockGroqCreate).toHaveBeenCalled();
  });
});

describe('vision.analyzeImage — failure', () => {
  it('throws when both providers fail', async () => {
    mockGeminiGenerate.mockRejectedValueOnce(new Error('gemini down'));
    mockGroqCreate.mockRejectedValueOnce(new Error('groq down'));
    await expect(vision.analyzeImage(imagePath)).rejects.toThrow(/Все vision провайдеры упали/);
  });

  it('does not write cache on failure', async () => {
    mockGeminiGenerate.mockRejectedValueOnce(new Error('x'));
    mockGroqCreate.mockRejectedValueOnce(new Error('y'));
    await expect(vision.analyzeImage(imagePath)).rejects.toThrow();
    expect(mockSetCache).not.toHaveBeenCalled();
  });
});

describe('vision.analyzeImage — retry', () => {
  it('retries on 503 and succeeds on second attempt', async () => {
    vi.useFakeTimers();
    const err503 = new Error('UNAVAILABLE');
    err503.status = 503;

    mockGeminiGenerate
      .mockRejectedValueOnce(err503)
      .mockResolvedValueOnce({ text: VALID_JSON });

    const promise = vision.analyzeImage(imagePath);
    // flush microtasks, потом продвинуть таймеры
    await vi.advanceTimersByTimeAsync(3000);
    const r = await promise;

    expect(r.description).toBe('A beautiful beach');
    expect(mockGeminiGenerate).toHaveBeenCalledTimes(2);
  });
});
