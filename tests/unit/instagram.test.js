import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockTrackPost } = vi.hoisted(() => ({
  mockTrackPost: vi.fn(),
}));

vi.mock('../../agent/usage.js', () => ({
  trackPost: mockTrackPost,
}));

let ig;
let fetchMock;

const account = {
  username: 'test_acc',
  igUserId: '12345',
  accessToken: 'tok123',
  city: 'phuket',
};

function res(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  mockTrackPost.mockReset();

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  ig = await import('../../agent/publishers/instagram.js');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('instagram.publishToInstagram — validation', () => {
  it('rejects missing igUserId', async () => {
    const r = await ig.publishToInstagram({
      account: { username: 'x', accessToken: 'tok' },
      imageUrl: 'https://img/x.jpg',
      caption: 'c',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/igUserId/);
  });

  it('rejects missing accessToken', async () => {
    const r = await ig.publishToInstagram({
      account: { username: 'x', igUserId: '1' },
      imageUrl: 'https://img/x.jpg',
      caption: 'c',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects non-HTTPS imageUrl', async () => {
    const r = await ig.publishToInstagram({
      account,
      imageUrl: 'http://insecure/x.jpg',
      caption: 'c',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/HTTPS/);
  });

  it('rejects missing imageUrl', async () => {
    const r = await ig.publishToInstagram({ account, imageUrl: '', caption: 'c' });
    expect(r.ok).toBe(false);
  });
});

describe('instagram.publishToInstagram — container creation', () => {
  it('returns error when create returns error field', async () => {
    fetchMock.mockReturnValueOnce(res({ error: { message: 'invalid token' } }, 400));
    const r = await ig.publishToInstagram({ account, imageUrl: 'https://img/x.jpg', caption: 'c' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('create_container');
    expect(r.error).toContain('invalid token');
  });

  it('sends correct form-urlencoded body', async () => {
    fetchMock
      .mockReturnValueOnce(res({ id: 'c1' }))
      .mockReturnValueOnce(res({ status_code: 'FINISHED' }))
      .mockReturnValueOnce(res({ id: 'p1' }));

    const promise = ig.publishToInstagram({
      account,
      imageUrl: 'https://img/x.jpg',
      caption: 'hello world',
    });
    await vi.advanceTimersByTimeAsync(3000);
    await promise;

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.instagram.com/v21.0/12345/media');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(opts.body);
    expect(body.get('image_url')).toBe('https://img/x.jpg');
    expect(body.get('caption')).toBe('hello world');
    expect(body.get('access_token')).toBe('tok123');
  });
});

describe('instagram.publishToInstagram — polling', () => {
  it('successful path: create → FINISHED → publish', async () => {
    fetchMock
      .mockReturnValueOnce(res({ id: 'c1' }))
      .mockReturnValueOnce(res({ status_code: 'FINISHED' }))
      .mockReturnValueOnce(res({ id: 'post_1' }));

    const promise = ig.publishToInstagram({ account, imageUrl: 'https://img/x.jpg', caption: 'c' });
    await vi.advanceTimersByTimeAsync(3000);
    const r = await promise;

    expect(r.ok).toBe(true);
    expect(r.postId).toBe('post_1');
    expect(mockTrackPost).toHaveBeenCalledTimes(1);
  });

  it('polls multiple times until FINISHED', async () => {
    fetchMock
      .mockReturnValueOnce(res({ id: 'c1' }))
      .mockReturnValueOnce(res({ status_code: 'IN_PROGRESS' }))
      .mockReturnValueOnce(res({ status_code: 'IN_PROGRESS' }))
      .mockReturnValueOnce(res({ status_code: 'FINISHED' }))
      .mockReturnValueOnce(res({ id: 'post_2' }));

    const promise = ig.publishToInstagram({ account, imageUrl: 'https://img/x.jpg', caption: 'c' });
    await vi.advanceTimersByTimeAsync(8000);
    const r = await promise;

    expect(r.ok).toBe(true);
    expect(r.postId).toBe('post_2');
  });

  it('returns error when container status_code ERROR', async () => {
    fetchMock
      .mockReturnValueOnce(res({ id: 'c1' }))
      .mockReturnValueOnce(res({ status_code: 'ERROR', status: 'Failed: bad image' }));

    const promise = ig.publishToInstagram({ account, imageUrl: 'https://img/x.jpg', caption: 'c' });
    await vi.advanceTimersByTimeAsync(3000);
    const r = await promise;

    expect(r.ok).toBe(false);
    expect(r.error).toContain('container error');
  });

  it('publishes anyway after 10 failed polls (timeout)', async () => {
    fetchMock.mockReturnValueOnce(res({ id: 'c1' }));
    for (let i = 0; i < 10; i++) {
      fetchMock.mockReturnValueOnce(res({ status_code: 'IN_PROGRESS' }));
    }
    fetchMock.mockReturnValueOnce(res({ id: 'post_3' }));

    const promise = ig.publishToInstagram({ account, imageUrl: 'https://img/x.jpg', caption: 'c' });
    await vi.advanceTimersByTimeAsync(25000);
    const r = await promise;

    expect(r.ok).toBe(true);
    expect(r.postId).toBe('post_3');
  });
});

describe('instagram.publishToInstagram — publish errors', () => {
  it('returns error when publish fails', async () => {
    fetchMock
      .mockReturnValueOnce(res({ id: 'c1' }))
      .mockReturnValueOnce(res({ status_code: 'FINISHED' }))
      .mockReturnValueOnce(res({ error: { message: 'publish failed' } }, 500));

    const promise = ig.publishToInstagram({ account, imageUrl: 'https://img/x.jpg', caption: 'c' });
    await vi.advanceTimersByTimeAsync(3000);
    const r = await promise;

    expect(r.ok).toBe(false);
    expect(r.error).toContain('publish');
    expect(r.error).toContain('publish failed');
    expect(mockTrackPost).not.toHaveBeenCalled();
  });

  it('catches network errors in try/catch', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const r = await ig.publishToInstagram({ account, imageUrl: 'https://img/x.jpg', caption: 'c' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('ECONNRESET');
  });

  it('includes durationMs in all responses', async () => {
    fetchMock.mockReturnValueOnce(res({ error: { message: 'x' } }, 400));
    const r = await ig.publishToInstagram({ account, imageUrl: 'https://img/x.jpg', caption: 'c' });
    expect(r).toHaveProperty('durationMs');
    expect(typeof r.durationMs).toBe('number');
  });
});
