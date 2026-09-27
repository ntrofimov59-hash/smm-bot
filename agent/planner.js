// agent/planner.js — выбирает оптимальное время публикации
// Исправлена работа с timezone (через Intl.formatToParts, независимо от локали сервера)

/**
 * Находит следующее свободное время для публикации.
 */
export function scheduleNext({ project, timezone = 'UTC', existing = [] } = {}) {
  const bestHours = project?.publishing?.bestHours || ['11:00', '19:00'];
  const minGapHours = project?.publishing?.minHoursBetweenPosts || 4;
  const minGapMs = minGapHours * 60 * 60 * 1000;

  const existingMs = existing.map(t => typeof t === 'number' ? t : new Date(t).getTime());

  const start = new Date(Date.now() + 15 * 60 * 1000);

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const baseDate = new Date(start);
    baseDate.setUTCDate(baseDate.getUTCDate() + dayOffset);

    for (const hhmm of bestHours) {
      const [h, m] = hhmm.split(':').map(Number);

      const candidate = createDateInTimezone(baseDate, h, m, timezone);

      if (candidate.getTime() <= Date.now() + 5 * 60 * 1000) continue;

      const tooClose = existingMs.some(t => Math.abs(t - candidate.getTime()) < minGapMs);
      if (tooClose) continue;

      return candidate;
    }
  }

  return new Date(Date.now() + 60 * 60 * 1000);
}

/**
 * Создаёт Date, соответствующий hour:minute в timezone на дату baseDate.
 */
function createDateInTimezone(baseDate, hour, minute, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(baseDate);
  const get = (type) => parts.find(p => p.type === type)?.value;

  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));

  // Предполагаем, что hour:minute — это wall-clock в timezone.
  // Строим UTC-время из этих компонентов как "guess".
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  // Считаем реальный offset timezone относительно UTC для этого момента.
  const offsetMs = getTimezoneOffsetMs(timezone, guess);

  // Если offset = +4ч (Yerevan), а мы хотим 11:00 Yerevan,
  // то нужно UTC = 11 - 4 = 07:00.
  return new Date(guess.getTime() - offsetMs);
}

/**
 * Возвращает offset timezone относительно UTC в миллисекундах.
 * Положительный = timezone восточнее UTC (Yerevan +4h, NY -5h).
 * Не зависит от локали сервера.
 */
function getTimezoneOffsetMs(timezone, date) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = dtf.formatToParts(date);
    const get = (t) => parts.find(p => p.type === t)?.value;

    const asUTC = Date.UTC(
      Number(get('year')),
      Number(get('month')) - 1,
      Number(get('day')),
      Number(get('hour')),
      Number(get('minute')),
      Number(get('second')),
    );

    return asUTC - date.getTime();
  } catch {
    return 0;
  }
}

/**
 * Распределяет N постов по дням, используя bestHours.
 */
export function planBatch({ count, project, timezone, existing = [] }) {
  const dates = [];
  const taken = [...existing.map(t => typeof t === 'number' ? t : new Date(t).getTime())];

  for (let i = 0; i < count; i++) {
    const next = scheduleNext({ project, timezone, existing: taken });
    dates.push(next);
    taken.push(next.getTime());
  }

  return dates;
}
