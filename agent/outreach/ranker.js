import { assessRelevance } from './relevance.js';
// agent/outreach/ranker.js — приоритизация кандидатов под event/wedding бизнес.
// Оценка 0..100. Без совпадения города при targetCity → сильно режем / отбрасываем.

const SEGMENT_WEIGHT = {
  venue: 32,
  agency: 28,      // wedding/event planners
  caterer: 24,
  contractor: 18,  // photo/video/decor как подрядчики
  corporate: 16,
  other: 4,
};

// Сегменты «нашего» направления (свадеб/ивенты)
const CORE_SEGMENTS = new Set(['venue', 'agency', 'caterer', 'contractor']);

const DEFAULT_HOME_CITIES = new Set([
  'yerevan', 'tbilisi', 'bali', 'phuket', 'prague', 'barcelona',
  'marrakech', 'casablanca', 'nha_trang', 'danang',
  'antalya', 'belgrade', 'budapest', 'goa', 'srilanka',
]);

function normCity(c) {
  return String(c || '').toLowerCase().trim().replace(/\s+/g, '_');
}

function hasContactChannels(c) {
  const channels = [];
  if (c.phone) channels.push('phone');
  if (c.email) channels.push('email');
  if (c.instagram) channels.push('instagram');
  if (c.telegram) channels.push('telegram');
  if (c.website) channels.push('website');
  return channels;
}

/**
 * @param {Object} candidate
 * @param {Object} opts
 * @param {string} [opts.targetCity] — если задан, город обязателен
 * @param {Set|string[]} [opts.homeCities]
 * @param {boolean} [opts.requireCity=true] — при targetCity отбрасывать чужие города
 * @param {string[]} [opts.preferredSegments]
 */
export function scoreCandidate(candidate, opts = {}) {
  const homeCities = opts.homeCities instanceof Set
    ? opts.homeCities
    : new Set(opts.homeCities || DEFAULT_HOME_CITIES);
  const targetCity = normCity(opts.targetCity || null);
  const requireCity = opts.requireCity !== false;
  const preferred = opts.preferredSegments
    ? new Set(opts.preferredSegments)
    : CORE_SEGMENTS;

  const b = {};
  const city = normCity(candidate.city);

  // Жёсткий фильтр: не тот город
  if (targetCity && requireCity && city !== targetCity) {
    return {
      score: 0,
      breakdown: { cityMismatch: true, city: 0, targetCity, actualCity: city || null },
      reject: true,
    };
  }

  // 1. Сегмент (до 32)
  b.segment = SEGMENT_WEIGHT[candidate.segment] ?? 4;
  if (preferred.has(candidate.segment)) b.segmentBonus = 6;
  else b.segmentBonus = 0;

  // 2. Город (до 28) — точное совпадение важнее «просто home»
  if (targetCity && city === targetCity) {
    b.city = 28;
  } else if (homeCities.has(city)) {
    b.city = 16;
  } else if (city) {
    b.city = 4;
  } else {
    b.city = 0;
  }

  // 3. Каналы (до 24)
  const channels = hasContactChannels(candidate);
  b.channels = Math.min(18, channels.length * 5);
  if (candidate.phone) b.channels += 4;
  if (candidate.instagram) b.channels += 3;
  b.channels = Math.min(b.channels, 24);

  // 4. «Проверенность» / Places (до 20)
  let trust = 0;
  const meta = candidate.meta || {};
  if (candidate.verified) trust += 10;
  if (meta.rating >= 4.5) trust += 6;
  else if (meta.rating >= 4.0) trust += 3;
  if (meta.userRatingCount >= 50) trust += 4;
  else if (meta.userRatingCount >= 15) trust += 2;
  if (Array.isArray(meta.types)) {
    const t = meta.types.join(' ');
    if (/event_venue|wedding|banquet|catering/i.test(t)) trust += 4;
  }
  if (candidate.website) trust += 2;
  b.trust = Math.min(trust, 20);

  // 5. Штрафы
  if (candidate.status === 'do_not_contact') {
    return { score: 0, breakdown: { ...b, penalty: -100 }, reject: true };
  }
  if (candidate.status === 'rejected') {
    return { score: 0, breakdown: { ...b, penalty: -50 }, reject: true };
  }
  if ((candidate.followupCount || 0) >= 1 && candidate.status === 'sent') {
    b.penalty = -12;
  }

  // Без города при requireCity и без target — мягкий штраф
  if (!city && requireCity) b.penalty = (b.penalty || 0) - 15;

    // 6. Релевантность events/wedding
  const rel = assessRelevance(candidate);
  b.relevance = rel.boost;
  if (!rel.ok) {
    return { score: 0, breakdown: { ...b, relevance: rel.boost, reject: rel.reason } };
  }

  const total = Math.max(0, Math.min(100,
    (b.segment || 0) + (b.segmentBonus || 0) + (b.city || 0)
    + (b.channels || 0) + (b.trust || 0) + (b.penalty || 0)
  ));

  return { score: Math.round(total), breakdown: b, reject: false };
}

/**
 * Ранжировать. По умолчанию выкидывает reject (чужой город / dnc).
 */
export function rankCandidates(candidates, opts = {}) {
  const dropReject = opts.dropReject !== false;
  const scored = candidates.map((c) => {
    const { score, breakdown, reject } = scoreCandidate(c, opts);
    return { ...c, score, breakdown, reject: !!reject };
  });
  const list = dropReject ? scored.filter((c) => !c.reject && c.score > 0) : scored;
  return list.sort((a, b) => b.score - a.score);
}

export { DEFAULT_HOME_CITIES, CORE_SEGMENTS, normCity };
