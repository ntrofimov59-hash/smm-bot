// agent/outreach/ranker.js — приоритизация кандидатов.
// Оценка 0..100. Чем выше — тем интереснее.

const SEGMENT_WEIGHT = {
  venue: 30,
  agency: 25,
  caterer: 20,
  corporate: 15,
  contractor: 12,
  other: 5,
};

// Города, в которых мы работаем (обычно из project.citySchedules — тут дефолт)
const DEFAULT_HOME_CITIES = new Set([
  'yerevan', 'tbilisi', 'bali', 'phuket', 'prague', 'barcelona',
  'marrakech', 'casablanca', 'nha_trang', 'danang',
]);

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
 * Скоринг одного кандидата.
 * @returns {{score:number, breakdown:Object}}
 */
export function scoreCandidate(candidate, opts = {}) {
  const homeCities = opts.homeCities instanceof Set ? opts.homeCities : DEFAULT_HOME_CITIES;
  const b = {};

  // 1. Сегмент (до 30)
  b.segment = SEGMENT_WEIGHT[candidate.segment] ?? 5;

  // 2. Город (до 20)
  const city = String(candidate.city || '').toLowerCase();
  b.city = homeCities.has(city) ? 20 : (city ? 8 : 0);

  // 3. Каналы связи (до 25)
  const channels = hasContactChannels(candidate);
  b.channels = Math.min(25, channels.length * 7);
  if (candidate.phone) b.channels += 3;              // wa.me — самый удобный
  if (candidate.instagram) b.channels += 3;          // IG — они там живут
  b.channels = Math.min(b.channels, 28);

  // 4. Google Places сигналы (до 22)
  let places = 0;
  const meta = candidate.meta || {};
  if (meta.rating && meta.rating >= 4.5) places += 8;
  else if (meta.rating && meta.rating >= 4.0) places += 5;
  if (meta.userRatingCount >= 100) places += 6;
  else if (meta.userRatingCount >= 20) places += 3;
  if (candidate.website) places += 4;
  if (Array.isArray(meta.types) && meta.types.includes('event_venue')) places += 4;
  b.places = Math.min(places, 22);

  // 5. Прямые штрафы
  if (candidate.status === 'do_not_contact') return { score: 0, breakdown: { ...b, penalty: -100 } };
  if (candidate.status === 'rejected') return { score: 0, breakdown: { ...b, penalty: -50 } };
  if (candidate.followupCount >= 1 && candidate.status === 'sent') {
    b.penalty = -10; // не строчить повторно
  }

  const total = Math.max(0, Math.min(100,
    (b.segment || 0) + (b.city || 0) + (b.channels || 0) + (b.places || 0) + (b.penalty || 0)
  ));

  return { score: Math.round(total), breakdown: b };
}

/**
 * Ранжировать список кандидатов и отсортировать по убыванию.
 */
export function rankCandidates(candidates, opts = {}) {
  return candidates
    .map(c => {
      const { score, breakdown } = scoreCandidate(c, opts);
      return { ...c, score, breakdown };
    })
    .sort((a, b) => b.score - a.score);
}
