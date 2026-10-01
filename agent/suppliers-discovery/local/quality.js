// agent/suppliers-discovery/local/quality.js — фильтр качества кандидатов.
// Отсекает: низкий рейтинг, мало отзывов, свежая регистрация, нет контактов.

const MIN_RATING = 4.0;
const MIN_REVIEWS = 3;
const MIN_AGE_DAYS = 180; // 6 месяцев

/**
 * @param {Object} c — кандидат с полями: rating, reviewsCount, registeredAt, phone, email, telegram, instagram, website, city
 * @param {Object} opts
 * @param {number} [opts.minRating=4.0]
 * @param {number} [opts.minReviews=3]
 * @param {number} [opts.minAgeDays=180]
 * @param {boolean} [opts.requireContacts=true]
 * @param {boolean} [opts.strict=false] — если true, отсеивает при ЛЮБОМ недостающем поле
 * @returns {{ok:boolean, reasons:string[], warnings:string[]}}
 */
export function checkQuality(c, opts = {}) {
  const minRating = opts.minRating ?? MIN_RATING;
  const minReviews = opts.minReviews ?? MIN_REVIEWS;
  const minAgeDays = opts.minAgeDays ?? MIN_AGE_DAYS;
  const requireContacts = opts.requireContacts ?? true;
  const strict = opts.strict ?? false;

  const reasons = [];
  const warnings = [];

  // Рейтинг
  if (typeof c.rating === 'number') {
    if (c.rating < minRating) reasons.push(`рейтинг ${c.rating} < ${minRating}`);
  } else if (strict) {
    reasons.push('нет рейтинга');
  } else {
    warnings.push('нет рейтинга');
  }

  // Отзывы
  if (typeof c.reviewsCount === 'number') {
    if (c.reviewsCount < minReviews) reasons.push(`отзывов ${c.reviewsCount} < ${minReviews}`);
  } else if (strict) {
    reasons.push('нет данных по отзывам');
  } else {
    warnings.push('нет данных по отзывам');
  }

  // Дата регистрации
  if (c.registeredAt) {
    const days = (Date.now() - new Date(c.registeredAt).getTime()) / 86400000;
    if (days < minAgeDays) reasons.push(`регистрация ${Math.round(days)} дней < ${minAgeDays}`);
  } else if (strict) {
    reasons.push('нет даты регистрации');
  } else {
    warnings.push('нет даты регистрации');
  }

  // Контакты
  if (requireContacts) {
    const has = c.phone || c.email || c.telegram || c.instagram || c.website;
    if (!has) reasons.push('нет контактов');
  }

  // Город
  if (!c.city) {
    if (strict) reasons.push('нет города');
    else warnings.push('нет города');
  }

  return { ok: reasons.length === 0, reasons, warnings };
}

/**
 * Фильтрует список кандидатов.
 */
export function filterByQuality(list, opts = {}) {
  const passed = [];
  const rejected = [];
  for (const c of list) {
    const q = checkQuality(c, opts);
    if (q.ok) passed.push({ ...c, _qualityWarnings: q.warnings });
    else rejected.push({ ...c, _rejectReasons: q.reasons });
  }
  return { passed, rejected };
}
