import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  mockSchedule,
  mockScanAllProjects,
  mockSchedulerTick,
  mockGetStats,
  mockCleanupOld,
  mockNotify,
  mockStartHealth,
  mockStartIngest,
} = vi.hoisted(() => ({
  mockSchedule: vi.fn((expr, fn) => ({ expr, fn, stop: vi.fn() })),
  mockScanAllProjects: vi.fn(),
  mockSchedulerTick: vi.fn(),
  mockGetStats: vi.fn(),
  mockCleanupOld: vi.fn(),
  mockNotify: vi.fn(),
  mockStartHealth: vi.fn().mockResolvedValue(null),
  mockStartIngest: vi.fn().mockReturnValue({ stop: vi.fn().mockResolvedValue() }),
}));

vi.mock('node-cron', () => ({
  default: { schedule: mockSchedule },
}));

vi.mock('../../agent/scanner.js', () => ({
  scanAllProjects: mockScanAllProjects,
}));

vi.mock('../../agent/scheduler.js', () => ({
  tick: mockSchedulerTick,
}));

vi.mock('../../agent/queue.js', () => ({
  getStats: mockGetStats,
  cleanupOld: mockCleanupOld,
}));

vi.mock('../../agent/telegram.js', () => ({
  notify: mockNotify,
}));

vi.mock('../../agent/health.js', () => ({
  startHealthServer: mockStartHealth,
  stopHealthServer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../agent/telegram-ingest.js', () => ({
  startIngestBot: mockStartIngest,
}));

let bot;
let logSpy;
let errSpy;

beforeEach(async () => {
  vi.resetModules();
  mockSchedule.mockReset().mockImplementation((expr, fn) => ({ expr, fn, stop: vi.fn() }));
  mockScanAllProjects.mockReset().mockResolvedValue({});
  mockSchedulerTick.mockReset().mockResolvedValue(undefined);
  mockGetStats.mockReset().mockReturnValue({ pending: 0, published: 0, failed: 0, total: 0 });
  mockCleanupOld.mockReset();
  mockNotify.mockReset().mockResolvedValue({ ok: true });
  mockStartHealth.mockReset().mockResolvedValue(null);
  mockStartIngest.mockReset().mockReturnValue({ stop: vi.fn().mockResolvedValue() });

  vi.stubEnv('SCAN_INTERVAL_MIN', '15');
  vi.stubEnv('SCHEDULER_INTERVAL_MIN', '1');
  vi.stubEnv('TELEGRAM_INGEST_BOT_TOKEN', 'test-token');

  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  bot = await import('../../bot.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('bot module — top-level', () => {
  it('does not auto-run main() when imported', () => {
    // Если бы main() запустился — mockSchedule был бы вызван
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('exports main as a function', () => {
    expect(typeof bot.main).toBe('function');
  });
});

describe('bot.main — cron schedules', () => {
  it('registers exactly 4 cron jobs', async () => {
    await bot.main();
    expect(mockSchedule).toHaveBeenCalledTimes(4);
  });

  it('uses SCAN_INTERVAL_MIN for scan cron', async () => {
    vi.stubEnv('SCAN_INTERVAL_MIN', '5');
    await bot.main();
    const exprs = mockSchedule.mock.calls.map(c => c[0]);
    expect(exprs).toContain('*/5 * * * *');
  });

  it('uses SCHEDULER_INTERVAL_MIN for scheduler cron', async () => {
    vi.stubEnv('SCHEDULER_INTERVAL_MIN', '2');
    await bot.main();
    const exprs = mockSchedule.mock.calls.map(c => c[0]);
    expect(exprs).toContain('*/2 * * * *');
  });

  it('cleanup runs at 4:00 daily', async () => {
    await bot.main();
    const exprs = mockSchedule.mock.calls.map(c => c[0]);
    expect(exprs).toContain('0 4 * * *');
  });

  it('falls back to 15/1 when env is missing', async () => {
    vi.unstubAllEnvs();
    await bot.main();
    const exprs = mockSchedule.mock.calls.map(c => c[0]);
    expect(exprs).toContain('*/15 * * * *');
    expect(exprs).toContain('*/1 * * * *');
  });

  it('falls back when env is non-numeric (NaN guard — bug fix)', async () => {
    vi.stubEnv('SCAN_INTERVAL_MIN', 'abc');
    vi.stubEnv('SCHEDULER_INTERVAL_MIN', 'xyz');
    await bot.main();
    const exprs = mockSchedule.mock.calls.map(c => c[0]);
    // Раньше было '*/NaN * * * *' → node-cron валится
    expect(exprs).toContain('*/15 * * * *');
    expect(exprs).toContain('*/1 * * * *');
    expect(exprs.some(e => e.includes('NaN'))).toBe(false);
  });

  it('falls back when env is empty string', async () => {
    vi.stubEnv('SCAN_INTERVAL_MIN', '');
    await bot.main();
    const exprs = mockSchedule.mock.calls.map(c => c[0]);
    expect(exprs).toContain('*/15 * * * *');
  });
});

describe('bot.main — initial scan', () => {
  it('calls scanAllProjects on startup', async () => {
    await bot.main();
    expect(mockScanAllProjects).toHaveBeenCalledOnce();
  });

  it('logs per-project stats', async () => {
    mockScanAllProjects.mockResolvedValue({
      'coucou-events': { scanned: 5, scheduled: 3, failed: 1 },
    });
    await bot.main();
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('coucou-events');
    expect(output).toContain('scanned=5');
    expect(output).toContain('scheduled=3');
    expect(output).toContain('failed=1');
  });

  it('survives initial scan failure (logs error, schedules jobs anyway)', async () => {
    mockScanAllProjects.mockRejectedValueOnce(new Error('vision down'));
    await bot.main();
    expect(mockSchedule).toHaveBeenCalledTimes(3);
    expect(mockNotify).toHaveBeenCalledOnce();
    const errs = errSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(errs).toContain('vision down');
  });
});

describe('bot.main — startup notification', () => {
  it('sends telegram notification with queue stats', async () => {
    mockGetStats.mockReturnValue({ pending: 2, published: 10, failed: 1, total: 13 });
    await bot.main();
    expect(mockNotify).toHaveBeenCalledOnce();
    const text = mockNotify.mock.calls[0][0];
    expect(text).toContain('pending=2');
    expect(text).toContain('published=10');
    expect(text).toContain('failed=1');
  });

  it('includes scan interval in message', async () => {
    vi.stubEnv('SCAN_INTERVAL_MIN', '7');
    await bot.main();
    expect(mockNotify.mock.calls[0][0]).toContain('7 мин');
  });
});

describe('bot.main — cron callbacks', () => {
  it('scan callback triggers scanAllProjects', async () => {
    await bot.main();
    mockScanAllProjects.mockClear();
    const scanJob = mockSchedule.mock.calls.find(c => c[0] === '*/15 * * * *');
    await scanJob[1]();
    expect(mockScanAllProjects).toHaveBeenCalledOnce();
  });

  it('scan callback catches errors without throwing', async () => {
    await bot.main();
    const scanJob = mockSchedule.mock.calls.find(c => c[0] === '*/15 * * * *');
    mockScanAllProjects.mockRejectedValueOnce(new Error('boom'));
    await expect(scanJob[1]()).resolves.toBeUndefined();
    const errs = errSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(errs).toContain('boom');
  });

  it('scheduler callback triggers tick', async () => {
    await bot.main();
    const schedJob = mockSchedule.mock.calls.find(c => c[0] === '*/1 * * * *');
    await schedJob[1]();
    expect(mockSchedulerTick).toHaveBeenCalledOnce();
  });

  it('scheduler callback catches errors', async () => {
    await bot.main();
    mockSchedulerTick.mockRejectedValueOnce(new Error('publish failed'));
    const schedJob = mockSchedule.mock.calls.find(c => c[0] === '*/1 * * * *');
    await schedJob[1]();
    const errs = errSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(errs).toContain('publish failed');
  });

  it('cleanup callback calls queue.cleanupOld with daysToKeep 30', async () => {
    await bot.main();
    const cleanupJob = mockSchedule.mock.calls.find(c => c[0] === '0 4 * * *');
    cleanupJob[1]();
    expect(mockCleanupOld).toHaveBeenCalledWith({ daysToKeep: 30 });
  });
});

describe('bot.main — telegram ingest', () => {
  it('starts ingest bot when TELEGRAM_INGEST_BOT_TOKEN set', async () => {
    vi.stubEnv('TELEGRAM_INGEST_BOT_TOKEN', 'tok');
    await bot.main();
    expect(mockStartIngest).toHaveBeenCalledOnce();
  });

  it('does NOT start ingest bot when token missing', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('SCAN_INTERVAL_MIN', '15');
    vi.stubEnv('SCHEDULER_INTERVAL_MIN', '1');
    // НЕ ставим TELEGRAM_INGEST_BOT_TOKEN
    vi.resetModules();
    const fresh = await import('../../bot.js');
    await fresh.main();
    expect(mockStartIngest).not.toHaveBeenCalled();
  });

  it('returns { jobs, ingest } object', async () => {
    vi.stubEnv('TELEGRAM_INGEST_BOT_TOKEN', 'tok');
    const result = await bot.main();
    expect(result).toHaveProperty('jobs');
    expect(result).toHaveProperty('ingest');
    expect(Array.isArray(result.jobs)).toBe(true);
  });

  it('survives ingest start failure (logs error, continues)', async () => {
    vi.stubEnv('TELEGRAM_INGEST_BOT_TOKEN', 'tok');
    mockStartIngest.mockImplementationOnce(() => { throw new Error('bad token'); });
    const result = await bot.main();
    expect(result.ingest).toBeNull();
    expect(mockNotify).toHaveBeenCalled();
  });
});

describe('bot.main — refresh tokens cron', () => {
  it('registers weekly refresh-tokens job (Sunday 3:00)', async () => {
    await bot.main();
    const exprs = mockSchedule.mock.calls.map(c => c[0]);
    expect(exprs).toContain('0 3 * * 0');
  });
});
