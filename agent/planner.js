// agent/planner.js — выбирает оптимальное время публикации
// Исправлена работа с timezone (через Intl.formatToParts, независимо от локали сервера)

/**
 * Находит следующее свободное время для публикации.
 */
/**
 * @param {Object} opts
 * @param {Object} opts.project
 * @param {string} [opts.timezone]        — фолбэк, если city не задан
 * @param {string} [opts.city]            — ключ города (yerevan, tbilisi, ...)
 * @param {'IMAGE'|'REELS'|'STORIES'} [opts.mediaType='IMAGE']
 * @param {number[]} [opts.existing]      — занятые слоты в ms (для anti-collision)
 * @param {() => number} [opts.rng]       — для тестов; по умолчанию Math.random
 */
/**
 * Возвращает локальный час (0-23) в заданной IANA-таймзоне.
 * Использует formatToParts — надёжнее, чем toLocaleString с hour: '2-digit'.
 */
function getLocalHour(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const v = parts.find(p => p.type === 'hour')?.value;
  const n = Number(v);
  // Некоторые платформы возвращают "24" для полуночи
  return n === 24 ? 0 : n;
}

export function scheduleNext({
  project,
  timezone = 'UTC',
  city = null,
  mediaType = 'IMAGE',
  existing = [],
  rng = Math.random,
} = {}) {
  // Расписание города (если задано), иначе — общий фолбэк
  const citySchedule = (city && project?.citySchedules?.[city]) || null;
  const effectiveTz = citySchedule?.timezone || timezone;

  // Для STORIES — только после storiesAfterHour локального времени
  let bestHours;
  if (mediaType === 'STORIES') {
    const after = citySchedule?.storiesAfterHour ?? 18;
    const until = citySchedule?.storiesUntilHour ?? 23;
    bestHours = [];
    for (let h = after; h < until; h++) {
      bestHours.push(String(h).padStart(2, '0') + ':00');
    }
    if (!bestHours.length) bestHours = [`${after}:00`];
  } else {
    bestHours = citySchedule?.peakHours || project?.publishing?.bestHours || ['11:00', '19:00'];
  }

  // Джиттер ±15 мин (для STORIES — ±10 мин, чтобы не выйти за окно)
  const jitterMin = mediaType === 'STORIES' ? 10 : 15;

  const minGapHours = project?.publishing?.minHoursBetweenPosts || 4;
  const minGapMs = minGapHours * 60 * 60 * 1000;
  const existingMs = existing.map(t => typeof t === 'number' ? t : new Date(t).getTime());

  // Стартуем от +15 мин от текущего момента
  const start = new Date(Date.now() + 15 * 60 * 1000);

  // Перемешиваем часы, чтобы не всегда выбирался первый
  const shuffledHours = [...bestHours].sort(() => rng() - 0.5);

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const baseDate = new Date(start);
    baseDate.setUTCDate(baseDate.getUTCDate() + dayOffset);

    for (const hhmm of shuffledHours) {
      const [h, m] = hhmm.split(':').map(Number);

      // Джиттер: сдвигаем минуты на ±jitterMin и секунды на ±50
      const offsetMin = Math.floor((rng() * 2 - 1) * jitterMin);
      const offsetSec = Math.floor((rng() * 2 - 1) * 50);

      const candidate = createDateInTimezone(baseDate, h, m, effectiveTz);
      candidate.setMinutes(candidate.getMinutes() + offsetMin, candidate.getSeconds() + offsetSec, 0);

      // Не ставим в прошлое
      if (candidate.getTime() <= Date.now() + 5 * 60 * 1000) continue;

      // Для STORIES — проверяем локальный час ПОСЛЕ джиттера
      if (mediaType === 'STORIES') {
        const localHour = getLocalHour(candidate, effectiveTz);
        const after = citySchedule?.storiesAfterHour ?? 18;
        const until = citySchedule?.storiesUntilHour ?? 23;
        if (localHour < after || localHour >= until) continue;
      }

      // Anti-collision: не ставим слишком близко к существующим
      const tooClose = existingMs.some(t => Math.abs(t - candidate.getTime()) < minGapMs);
      if (tooClose) continue;

      return candidate;
    }
  }

  // Fallback: ищем первый безопасный слот через час с учётом локального часа
  let fb = new Date(Date.now() + 60 * 60 * 1000);
  if (mediaType === 'STORIES') {
    const after = citySchedule?.storiesAfterHour ?? 18;
    const until = citySchedule?.storiesUntilHour ?? 23;
    // Двигаем вперёд, пока не попадём в окно (максимум 24 часа)
    for (let i = 0; i < 24; i++) {
      const lh = getLocalHour(fb, effectiveTz);
      if (lh >= after && lh < until) break;
      fb = new Date(fb.getTime() + 60 * 60 * 1000);
    }
  }
  return fb;
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

  // Сортируем — shuffle часов в scheduleNext может дать слоты в разном порядке
  return dates.sort((a, b) => a.getTime() - b.getTime());
}
