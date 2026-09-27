import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let pinterest;

beforeEach(async () => {
  vi.resetModules();
  pinterest = await import('../../agent/sources/pinterest.js');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pinterest.parsePinterestHtml', () => {
  it('returns [] for empty/invalid input', () => {
    expect(pinterest.parsePinterestHtml('')).toEqual([]);
    expect(pinterest.parsePinterestHtml(null)).toEqual([]);
    expect(pinterest.parsePinterestHtml(undefined)).toEqual([]);
  });

  it('extracts i.pinimg.com URLs', () => {
    const html = `
      <img src="https://i.pinimg.com/736x/ab/cd/ef/photo1.jpg">
      <img src="https://i.pinimg.com/736x/12/34/56/photo2.jpg">
    `;
    const r = pinterest.parsePinterestHtml(html);
    expect(r).toHaveLength(2);
    expect(r[0].imageUrl).toContain('i.pinimg.com');
  });

  it('normalizes size prefixes to 736x', () => {
    const html = `
      <img src="https://i.pinimg.com/236x/ab/cd/ef/a.jpg">
      <img src="https://i.pinimg.com/474x/ab/cd/ef/b.jpg">
      <img src="https://i.pinimg.com/originals/ab/cd/ef/c.jpg">
    `;
    const r = pinterest.parsePinterestHtml(html);
    for (const p of r) {
      expect(p.imageUrl).toContain('/736x/');
    }
  });

  it('deduplicates same pin across sizes', () => {
    const html = `
      <img src="https://i.pinimg.com/236x/ab/cd/ef/pin.jpg">
      <img src="https://i.pinimg.com/736x/ab/cd/ef/pin.jpg">
      <img src="https://i.pinimg.com/originals/ab/cd/ef/pin.jpg">
    `;
    const r = pinterest.parsePinterestHtml(html);
    expect(r).toHaveLength(1);
  });

  it('returns sourceId=null (regex approach cannot map pin id to CDN url)', () => {
    // Pinterest CDN url не содержит pin id — только hash. Pin id приходит
    // в отдельном <a href="/pin/<id>/"> и не связан с <img> без парсинга
    // __PWS_DATA__. См. README → Pinterest source: known limitations.
    const html = `<a href="https://www.pinterest.com/pin/123456789/">link</a>
      <img src="https://i.pinimg.com/736x/ab/cd/ef/photo.jpg">`;
    const r = pinterest.parsePinterestHtml(html);
    expect(r).toHaveLength(1);
    expect(r[0].sourceId).toBeNull();
  });

  it('skips user avatar URLs', () => {
    const html = `
      <img src="https://i.pinimg.com/736x/user/ab/cd/avatar.jpg">
      <img src="https://i.pinimg.com/736x/ok/12/34/photo.jpg">
    `;
    const r = pinterest.parsePinterestHtml(html);
    expect(r).toHaveLength(1);
    expect(r[0].imageUrl).toContain('/ok/');
  });

  it('respects limit', () => {
    const html = Array.from({ length: 10 }, (_, i) =>
      `<img src="https://i.pinimg.com/736x/${i}/img${i}.jpg">`
    ).join('\n');
    const r = pinterest.parsePinterestHtml(html, { limit: 3 });
    expect(r).toHaveLength(3);
  });

  it('returns empty when no pins found', () => {
    const html = '<html><body>nothing to see here</body></html>';
    expect(pinterest.parsePinterestHtml(html)).toEqual([]);
  });
});

describe('pinterest.fetchPinterestBoard', () => {
  it('rejects invalid URL', async () => {
    await expect(pinterest.fetchPinterestBoard('not-a-url'))
      .rejects.toThrow(/некорректный board URL/);
    await expect(pinterest.fetchPinterestBoard('http://pinterest.com/x/y/'))
      .rejects.toThrow(/некорректный/);
  });

  it('fetches and returns enriched pins', async () => {
    const html = `<img src="https://i.pinimg.com/736x/ab/cd/ef/one.jpg">
                  <img src="https://i.pinimg.com/736x/12/34/56/two.jpg">`;
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    });
    const r = await pinterest.fetchPinterestBoard('https://www.pinterest.com/user/board/', { fetchImpl });
    expect(r).toHaveLength(2);
    expect(r[0].source).toBe('pinterest');
    expect(r[0].sourceUrl).toContain('pinterest.com/user/board');
  });

  it('throws on non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(pinterest.fetchPinterestBoard(
      'https://www.pinterest.com/u/b/', { fetchImpl }
    )).rejects.toThrow(/HTTP 404/);
  });

  it('sends browser-like User-Agent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    await pinterest.fetchPinterestBoard('https://www.pinterest.com/u/b/', { fetchImpl });
    const [, opts] = fetchImpl.mock.calls[0];
    expect(opts.headers['User-Agent']).toMatch(/Mozilla/);
    expect(opts.headers['Accept']).toContain('text/html');
  });

  it('respects limit', async () => {
    const html = Array.from({ length: 20 }, (_, i) =>
      `<img src="https://i.pinimg.com/736x/${i}/x.jpg">`
    ).join('');
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => html });
    const r = await pinterest.fetchPinterestBoard(
      'https://www.pinterest.com/u/b/',
      { fetchImpl, limit: 5 }
    );
    expect(r).toHaveLength(5);
  });
});

describe('pinterest.fetchPinterestSearch', () => {
  it('rejects empty query', async () => {
    await expect(pinterest.fetchPinterestSearch('')).rejects.toThrow(/query/);
    await expect(pinterest.fetchPinterestSearch(null)).rejects.toThrow(/query/);
  });

  it('builds search URL from query', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    await pinterest.fetchPinterestSearch('phuket beach', { fetchImpl });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://www.pinterest.com/search/pins/?q=phuket%20beach');
  });

  it('extracts and enriches pins', async () => {
    const html = '<img src="https://i.pinimg.com/736x/aa/bb/x.jpg">';
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => html });
    const r = await pinterest.fetchPinterestSearch('phuket', { fetchImpl });
    expect(r).toHaveLength(1);
    expect(r[0].source).toBe('pinterest-search');
    expect(r[0].query).toBe('phuket');
    expect(r[0].sourceUrl).toContain('phuket');
  });

  it('throws on non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(pinterest.fetchPinterestSearch('x', { fetchImpl }))
      .rejects.toThrow(/HTTP 429/);
  });

  it('respects limit', async () => {
    const html = Array.from({ length: 20 }, (_, i) =>
      `<img src="https://i.pinimg.com/736x/${i}/x.jpg">`).join('');
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => html });
    const r = await pinterest.fetchPinterestSearch('x', { fetchImpl, limit: 3 });
    expect(r).toHaveLength(3);
  });
});

describe('pinterest.parsePinterestHtml — robustness', () => {
  it('stops at CSS characters (}, {, ;, ,)', () => {
    const html = `
      <style>
        .x { background: url(https://i.pinimg.com/736x/aa/bb/clean.jpg)} .y{}
      </style>
      <img src="https://i.pinimg.com/736x/cc/dd/normal.jpg">
    `;
    const r = pinterest.parsePinterestHtml(html);
    for (const pin of r) {
      expect(pin.imageUrl).not.toMatch(/[{};,()]/);
    }
  });

  it('keeps legit URLs with dashes/underscores/dots', () => {
    const html = '<img src="https://i.pinimg.com/736x/ab-cd/ef_gh/photo-1.2.jpg">';
    const r = pinterest.parsePinterestHtml(html);
    expect(r).toHaveLength(1);
    expect(r[0].imageUrl).toBe('https://i.pinimg.com/736x/ab-cd/ef_gh/photo-1.2.jpg');
  });

  it('handles real-world inline-style garbage', () => {
    const html = '<img src="https://i.pinimg.com/736x/d5/3b/01/photo.png)}._YsBbF{border:0}">';
    const r = pinterest.parsePinterestHtml(html);
    expect(r).toHaveLength(1);
    expect(r[0].imageUrl).toBe('https://i.pinimg.com/736x/d5/3b/01/photo.png');
  });
});
