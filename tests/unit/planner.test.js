import { describe, it, expect } from 'vitest';
import { scheduleNext, planBatch } from '../../agent/planner.js';

const project = {
  publishing: {
    bestHours: ['11:00', '19:00'],
    minHoursBetweenPosts: 4,
  },
};

describe('planner.scheduleNext', () => {
  it('возвращает Date в будущем', () => {
    const d = scheduleNext({ project, timezone: 'UTC' });
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).toBeGreaterThan(Date.now());
  });

  it('не ставит пост ближе 5 минут от "сейчас"', () => {
    const d = scheduleNext({ project, timezone: 'UTC' });
    const diffMin = (d.getTime() - Date.now()) / 60000;
    expect(diffMin).toBeGreaterThanOrEqual(5);
  });

  it('корректно применяет timezone Asia/Yerevan (UTC+4)', () => {
    const d = scheduleNext({
      project: { publishing: { bestHours: ['11:00'], minHoursBetweenPosts: 0 } },
      timezone: 'Asia/Yerevan',
    });
    // 11:00 Yerevan = 07:00 UTC
    expect(d.getUTCHours()).toBe(7);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it('учитывает минимальный интервал с existing', () => {
    const now = Date.now();
    const existing = [
      now + 60 * 60 * 1000, // +1 час
      now + 2 * 60 * 60 * 1000,
    ];
    const d = scheduleNext({ project, timezone: 'UTC', existing });
    // должен быть не ближе 4 часов от любого existing
    for (const t of existing) {
      expect(Math.abs(d.getTime() - t)).toBeGreaterThanOrEqual(4 * 60 * 60 * 1000);
    }
  });

  it('возвращает фолбэк +1ч если ничего не нашли', () => {
    // передаём кучу занятых слотов
    const now = Date.now();
    const existing = Array.from({ length: 1000 }, (_, i) => now + i * 60 * 1000);
    const d = scheduleNext({ project, timezone: 'UTC', existing });
    expect(d.getTime()).toBeGreaterThan(Date.now());
  });

  it('работает с пустым project (defaults)', () => {
    const d = scheduleNext({});
    expect(d).toBeInstanceOf(Date);
  });
});

describe('planner.planBatch', () => {
  it('возвращает N уникальных дат', () => {
    const dates = planBatch({
      count: 5,
      project,
      timezone: 'Asia/Yerevan',
    });
    expect(dates).toHaveLength(5);
    const times = dates.map(d => d.getTime());
    expect(new Set(times).size).toBe(5);
  });

  it('даты отсортированы (каждая следующая позже)', () => {
    const dates = planBatch({ count: 3, project, timezone: 'UTC' });
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i].getTime()).toBeGreaterThanOrEqual(dates[i - 1].getTime());
    }
  });
});

describe('planner timezone edge cases', () => {
  it('America/New_York (UTC-5) — 11:00 NY = 16:00 UTC (winter)', () => {
    const d = scheduleNext({
      project: { publishing: { bestHours: ['11:00'], minHoursBetweenPosts: 0 } },
      timezone: 'America/New_York',
    });
    // NY в сентябре = UTC-4 (DST). 11:00 NY = 15:00 UTC
    // Тест не привязан к дате — проверяем, что разница между "wall clock 11:00"
    // и UTC датой = offset timezone в этот момент.
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const [hh, mm] = formatter.format(d).split(':');
    expect(Number(hh)).toBe(11);
    expect(Number(mm)).toBe(0);
  });

  it('Asia/Yerevan — roundtrip: wall-clock 19:00 = тот же час в timezone', () => {
    const d = scheduleNext({
      project: { publishing: { bestHours: ['19:00'], minHoursBetweenPosts: 0 } },
      timezone: 'Asia/Yerevan',
    });
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Yerevan',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const [hh, mm] = formatter.format(d).split(':');
    expect(Number(hh)).toBe(19);
    expect(Number(mm)).toBe(0);
  });
});
