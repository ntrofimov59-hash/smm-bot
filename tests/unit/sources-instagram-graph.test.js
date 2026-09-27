import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let ig;

beforeEach(async () => {
  vi.resetModules();
  ig = await import('../../agent/sources/instagram-graph.js');
});

afterEach(() => {
  vi.restoreAllMocks();
});

function res(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('instagram-graph.fetchOwnMedia — validation', () => {
  it('требует accessToken', async () => {
    await expect(ig.fetchOwnMedia({})).rejects.toThrow(/accessToken/);
  });

  it('rejects limit < 1', async () => {
    await expect(ig.fetchOwnMedia({ accessToken: 't', limit: 0 }))
      .rejects.toThrow(/1\.\.100/);
  });

  it('rejects limit > 100', async () => {
    await expect(ig.fetchOwnMedia({ accessToken: 't', limit: 101 }))
      .rejects.toThrow(/1\.\.100/);
  });
});

describe('instagram-graph.fetchOwnMedia — happy path', () => {
  it('returns normalized list filtered to IMAGE/CAROUSEL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({
      data: [
        { id: '1', media_url: 'https://cdn/1.jpg', caption: 'a', permalink: 'https://ig/p/1', timestamp: '2026-01-01', media_type: 'IMAGE' },
        { id: '2', media_url: 'https://cdn/2.mp4', caption: 'b', media_type: 'VIDEO' },
        { id: '3', media_url: 'https://cdn/3.jpg', caption: 'c', media_type: 'CAROUSEL_ALBUM' },
      ],
    }));

    const r = await ig.fetchOwnMedia({ accessToken: 'tok', fetchImpl });
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ id: '1', mediaUrl: 'https://cdn/1.jpg', source: 'instagram-graph' });
    expect(r[1].mediaType).toBe('CAROUSEL_ALBUM');
  });

  it('sends correct URL with access_token and fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({ data: [] }));
    await ig.fetchOwnMedia({ accessToken: 'secret_tok', limit: 10, fetchImpl });

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toContain('graph.instagram.com/v21.0/me/media');
    expect(url).toContain('access_token=secret_tok');
    expect(url).toContain('limit=10');
    expect(url).toContain('fields=id');
    expect(url).toContain('media_url');
    expect(opts.headers['Accept']).toBe('application/json');
  });

  it('returns [] when no data', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({ data: [] }));
    expect(await ig.fetchOwnMedia({ accessToken: 't', fetchImpl })).toEqual([]);
  });

  it('handles missing data field', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({}));
    expect(await ig.fetchOwnMedia({ accessToken: 't', fetchImpl })).toEqual([]);
  });

  it('supports custom fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({ data: [] }));
    await ig.fetchOwnMedia({ accessToken: 't', fields: ['id', 'media_url'], fetchImpl });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain('fields=id%2Cmedia_url');
  });
});

describe('instagram-graph.fetchOwnMedia — errors', () => {
  it('propagates API error message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(
      { error: { message: 'Invalid OAuth access token' } },
      400,
    ));
    await expect(ig.fetchOwnMedia({ accessToken: 'bad', fetchImpl }))
      .rejects.toThrow(/Invalid OAuth access token/);
  });

  it('handles non-JSON error body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('bad json'); },
    });
    await expect(ig.fetchOwnMedia({ accessToken: 't', fetchImpl }))
      .rejects.toThrow(/HTTP 500/);
  });
});

describe('instagram-graph.fetchUserMedia', () => {
  it('требует igUserId', async () => {
    await expect(ig.fetchUserMedia({ accessToken: 't' })).rejects.toThrow(/igUserId/);
  });

  it('требует accessToken', async () => {
    await expect(ig.fetchUserMedia({ igUserId: '1' })).rejects.toThrow(/accessToken/);
  });

  it('fetches from /{igUserId}/media', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({ data: [] }));
    await ig.fetchUserMedia({ igUserId: '999', accessToken: 'tok', fetchImpl });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain('/999/media');
  });

  it('normalizes items same as fetchOwnMedia', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({
      data: [
        { id: '1', media_url: 'https://cdn/x.jpg', media_type: 'IMAGE' },
      ],
    }));
    const r = await ig.fetchUserMedia({ igUserId: '1', accessToken: 't', fetchImpl });
    expect(r[0].source).toBe('instagram-graph');
    expect(r[0].mediaUrl).toBe('https://cdn/x.jpg');
  });
});
