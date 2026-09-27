// agent/planner.js — выбирает оптимальное время публикации
// Исправлена работа с timezone (используем правильный offset через Intl)

/**
 * Находит следующее свободное время для публикации.
 * @param {Object} opts
 * @param {Object} opts.project — project.json (publishing: {bestHours, postsPerDay})
 * @param {string} opts.timezone — IANA timezone (Asia/Yerevan)
 * @param {Array} opts.existing — уже занятые timestamp'ы (числа или ISO-строки)
 * @returns {Date}
 */
export function scheduleNext({ project, timezone = 'UTC', existing = [] } = {}) {
  const bestHours = project?.publishing?.bestHours || ['11:00', '19:00'];
  const minGapHours = project?.publishing?.minHoursBetweenPosts || 4;
  const minGapMs = minGapHours * 60 * 60 * 1000;

  const existingMs = existing.map(t => typeof t === 'number' ? t : new Date(t).getTime());

  // Начинаем с "сейчас + 15 минут"
  const start = new Date(Date.now() + 15 * 60 * 1000);

  // Ищем в течение 14 дней
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const baseDate = new Date(start);
    baseDate.setUTCDate(baseDate.getUTCDate() + dayOffset);

    for (const hhmm of bestHours) {
      const [h, m] = hhmm.split(':').map(Number);

      // Создаём кандидата в нужном timezone
      const candidate = createDateInTimezone(baseDate, h, m, timezone);

      // Если в прошлом — пропускаем
      if (candidate.getTime() <= Date.now() + 5 * 60 * 1000) continue;

      // Проверяем минимальный интервал с существующими
      const tooClose = existingMs.some(t => Math.abs(t - candidate.getTime()) < minGapMs);
      if (tooClose) continue;

      return candidate;
    }
  }

  // Фолбэк: просто +1 час
  return new Date(Date.now() + 60 * 60 * 1000);
}

/**
 * Создаёт Date, соответствующий указанному часу:минуте в заданном timezone
 * на дату baseDate (берём год/месяц/день из baseDate).
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

  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  const offsetMs = getTimezoneOffsetMs(timezone, guess);
  return new Date(guess.getTime() - offsetMs);
}

/**
 * Возвращает offset timezone в миллисекундах относительно UTC
 */
function getTimezoneOffsetMs(timezone, date) {
  try {
    const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr = date.toLocaleString('en-US', { timeZone: timezone });
    const utcDate = new Date(utcStr);
    const tzDate = new Date(tzStr);
    return utcDate.getTime() - tzDate.getTime();
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
