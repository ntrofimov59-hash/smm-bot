import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// vi.hoisted — переменные, доступные в vi.mock (который hoisted)
const { mockCreate, mockCanCallGroq, mockTrackGroq } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockCanCallGroq: vi.fn(() => ({ ok: true })),
  mockTrackGroq: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class OpenAI {
    constructor() {
      this.chat = { completions: { create: mockCreate } };
    }
  },
}));

vi.mock('../../agent/usage.js', () => ({
  canCallGroq: mockCanCallGroq,
  trackGroq: mockTrackGroq,
}));

let caption;

const project = {
  brand: {
    tone: 'warm',
    voice: 'Anna',
    emoji: 'few',
    avoid: [],
    signature: 'Команда Coucou Events 🎉',
  },
  publishing: { maxHashtags: 12 },
};

function mockGroqResponse(content, tokens = 100) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content } }],
    usage: { total_tokens: tokens },
  });
}

beforeEach(async () => {
  vi.resetModules();
  mockCreate.mockReset();
  mockCanCallGroq.mockReset().mockReturnValue({ ok: true });
  mockTrackGroq.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  caption = await import('../../agent/caption.js');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('caption.generateCaption — happy path', () => {
  it('parses CAPTION/HASHTAGS structured response', async () => {
    mockGroqResponse(`CAPTION:
Beautiful sunset in Phuket 🌅

HASHTAGS:
#phuket #sunset #beach`);
    const r = await caption.generateCaption({ project, description: 'beach' });
    expect(r.caption).toContain('Beautiful sunset');
    expect(r.hashtags).toEqual(['#phuket', '#sunset', '#beach']);
    expect(r.tokens).toBe(100);
  });

  it('adds brand signature when missing', async () => {
    mockGroqResponse('CAPTION:\nJust a short caption\n\nHASHTAGS:\n#test');
    const r = await caption.generateCaption({ project });
    expect(r.caption).toContain('Команда Coucou Events');
  });

  it('does not duplicate signature', async () => {
    mockGroqResponse('CAPTION:\nHello from Coucou Events\n\nHASHTAGS:\n#test');
    const r = await caption.generateCaption({ project });
    const matches = (r.caption.match(/Coucou Events/g) || []).length;
    expect(matches).toBe(1);
  });

  it('tracks tokens via usage.trackGroq', async () => {
    mockGroqResponse('CAPTION:\ntext\n\nHASHTAGS:\n#a', 1234);
    await caption.generateCaption({ project });
    expect(mockTrackGroq).toHaveBeenCalledWith(1234);
  });

  it('truncates hashtags to maxHashtags', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `#tag${i}`).join(' ');
    mockGroqResponse(`CAPTION:\ntext\n\nHASHTAGS:\n${many}`);
    const r = await caption.generateCaption({
      project: { ...project, publishing: { maxHashtags: 5 } },
    });
    expect(r.hashtags).toHaveLength(5);
  });
});

describe('caption.generateCaption — parsing fallbacks', () => {
  it('parses JSON response when CAPTION: missing', async () => {
    mockGroqResponse('{"caption":"JSON caption","hashtags":["#a","#b"]}');
    const r = await caption.generateCaption({ project });
    expect(r.caption).toContain('JSON caption');
    expect(r.hashtags).toEqual(expect.arrayContaining(['#a', '#b']));
  });

  it('parses plain text with hashtags on separate line', async () => {
    mockGroqResponse('Just plain caption\nwith two lines\n#tag1 #tag2');
    const r = await caption.generateCaption({ project });
    expect(r.caption).toContain('Just plain caption');
    expect(r.hashtags).toContain('#tag1');
  });

  it('uses fallback caption when LLM returns empty CAPTION', async () => {
    mockGroqResponse('CAPTION:\n\nHASHTAGS:\n#x');
    const r = await caption.generateCaption({ project, city: 'Yerevan' });
    expect(r.caption).toContain('Yerevan');
  });
});

describe('caption.generateCaption — limits and errors', () => {
  it('returns limited:true and skips API when Groq limit reached', async () => {
    mockCanCallGroq.mockReturnValueOnce({ ok: false, reason: 'groq_day_limit' });
    const r = await caption.generateCaption({ project, city: 'Phuket' });
    expect(r.limited).toBe(true);
    expect(r.caption).toContain('Phuket');
    expect(r.tokens).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns fallback on Groq API error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('rate limit exceeded'));
    const r = await caption.generateCaption({ project, city: 'Paris' });
    expect(r.caption).toContain('Paris');
    expect(r.error).toBe('rate limit exceeded');
    expect(r.hashtags).toEqual([]);
    expect(r.tokens).toBe(0);
  });

  it('language en produces English fallback text', async () => {
    mockCreate.mockRejectedValueOnce(new Error('fail'));
    const r = await caption.generateCaption({ project, lang: 'en', city: 'London' });
    expect(r.caption).toMatch(/events/);
  });

  it('language hy produces Armenian fallback text', async () => {
    mockCreate.mockRejectedValueOnce(new Error('fail'));
    const r = await caption.generateCaption({ project, lang: 'hy', city: 'Yerevan' });
    expect(r.caption).toMatch(/Ստեղծում/);
  });
});
