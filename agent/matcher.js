// agent/matcher.js — определяет, в какие города публиковать данное фото
// Логика: если фото имеет тег "beach" — публикуем в города с tag "beach"

/**
 * @param {Object} opts
 * @param {string[]} opts.imageTags — теги, полученные из vision.js
 * @param {Array} opts.accounts — массив аккаунтов из accounts.json (с cityTags)
 * @returns {Array} — массив подходящих аккаунтов, отсортированных по релевантности
 */
export function matchAccountsByTags(imageTags, accounts) {
  if (!imageTags?.length || !accounts?.length) return [];

  const imageTagSet = new Set(imageTags.map(t => t.toLowerCase()));
  const scored = [];

  for (const acc of accounts) {
    if (!acc.active) continue;
    const cityTags = (acc.cityTags || []).map(t => t.toLowerCase());
    if (!cityTags.length) {
      // Нет тегов у города — добавляем «на всякий случай» с минимальным баллом
      scored.push({ acc, score: 0.1, matchedTags: [] });
      continue;
    }
    const matched = cityTags.filter(t => imageTagSet.has(t));
    if (matched.length > 0) {
      // Скор = доля совпавших тегов + небольшой бонус за количество
      const score = matched.length / Math.max(cityTags.length, 1) + matched.length * 0.1;
      scored.push({ acc, score, matchedTags: matched });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .map(s => ({ ...s.acc, _score: s.score, _matchedTags: s.matchedTags }));
}

/**
 * Возвращает только лучшие совпадения — те, что выше порога.
 * Если ни один не подошёл выше порога, возвращает top-1.
 */
export function pickBestMatches(imageTags, accounts, { minScore = 0.3, maxResults = 5 } = {}) {
  const all = matchAccountsByTags(imageTags, accounts);
  if (!all.length) return [];
  const filtered = all.filter(a => a._score >= minScore);
  return (filtered.length ? filtered : [all[0]]).slice(0, maxResults);
}
