// agent/planner.js — выбирает оптимальное время публикации
// Логика: используем bestHours из project.json, избегаем коллизий

/**
 * Находит следующее свободное время для публикации.
 * @param {Object} opts
 * @param {Object} opts.project — project.json (publishing: {bestHours, postsPerDay})
 * @param {string} opts.timezone — IANA timezone (Asia/Yerevan)
 * @param {Array} opts.existing — уже занятые timestamp'ы (числа)
 * @returns {Date}
 */
export function scheduleNext({ project, timezone = 'UTC', existing = [] } = {}) {
  const bestHours = project?.publishing?.bestHours || ['11:00', '19:00'];
  const minGapHours = project?.publishing?.minHoursBetweenPosts || 4;
  const minGapMs = minGapHours * 60 * 60 * 1000;

  const existingMs = existing.map(t => typeof t === 'number' ? t : new Date(t).getTime());

  // Начинаем с "сейчас + 15 минут" — чтобы scheduler успел подхватить
  const start = new Date(Date.now() + 15 * 60 * 1000);

  // Ищем в течение 14 дней
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const baseDate = new Date(start);
    baseDate.setDate(baseDate.getDate() + dayOffset);

    for (const hhmm of bestHours) {
      const [h, m] = hhmm.split(':').map(Number);

      // Создаём дату в UTC и потом корректируем под timezone
      const candidate = new Date(baseDate);
      candidate.setUTCHours(h, m, 0, 0);

      // Корректируем на смещение timezone
      const offset = getTimezoneOffset(timezone, candidate);
      const adjusted = new Date(candidate.getTime() + offset);

      // Если в прошлом — пропускаем
      if (adjusted.getTime() <= Date.now() + 5 * 60 * 1000) continue;

      // Проверяем минимальный интервал с существующими
      const tooClose = existingMs.some(t => Math.abs(t - adjusted.getTime()) < minGapMs);
      if (tooClose) continue;

      return adjusted;
    }
  }

  // Фолбэк: просто +1 час
  return new Date(Date.now() + 60 * 60 * 1000);
}

// Простой расчёт смещения timezone через Intl
function getTimezoneOffset(timezone, date) {
  try {
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    return utcDate.getTime() - tzDate.getTime();
  } catch {
    return 0;
  }
}

/**
 * Распределяет N постов по дням, используя bestHours.
 * @returns {Date[]} — массив дат
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
