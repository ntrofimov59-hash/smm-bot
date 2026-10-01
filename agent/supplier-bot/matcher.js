// agent/supplier-bot/matcher.js — поиск поставщиков с жёстким городом и verified.
import * as store from '../suppliers/store.js';

function normCity(c) {
  return String(c || '').toLowerCase().trim().replace(/\s+/g, '_');
}

/**
 * Скоринг поставщика под запрос.
 */
export function scoreSupplier(s, query = {}) {
  let score = 0;
  const b = {};

  // verified — главный сигнал «проверенный»
  if (s.verified) {
    b.verified = 40;
    score += 40;
  } else {
    b.verified = 0;
  }

  // город
  const qCity = normCity(query.city);
  const sCity = normCity(s.city);
  if (qCity && sCity === qCity) {
    b.city = 35;
    score += 35;
  } else if (qCity && sCity && sCity !== qCity) {
    b.city = -50;
    score -= 50;
  } else if (!sCity) {
    b.city = -10;
    score -= 10;
  }

  // рейтинг и опыт
  if (s.rating) {
    b.rating = Math.round((Number(s.rating) || 0) * 4); // 0..20
    score += b.rating;
  }
  if (s.projectsCount) {
    b.projects = Math.min(10, Number(s.projectsCount) || 0);
    score += b.projects;
  }

  // event-friendly
  if (s.worksWithForeigners) {
    b.foreigners = 8;
    score += 8;
  }
  if (s.phone || s.instagram || s.telegram) {
    b.contact = 7;
    score += 7;
  }

  // вместимость под гостей
  if (query.guests && s.capacity) {
    if (s.capacity >= query.guests) {
      b.capacity = 10;
      score += 10;
    } else {
      b.capacity = -5;
      score -= 5;
    }
  }

  return { score, breakdown: b };
}

/**
 * @param {boolean} [opts.requireVerified] — default из env SUPPLIER_REQUIRE_VERIFIED=1
 * @param {boolean} [opts.allowCityFallback] — default false (не подмешивать другие города)
 * @param {boolean} [opts.strictCity] — default true
 */
export function matchSuppliers(projectPath, query, opts = {}) {
  if (!query.category) {
    return { ok: false, reason: 'no_category', list: [], total: 0 };
  }

  const _requireVerified = opts.requireVerified
    ?? !['0', 'false', 'off'].includes(String(process.env.SUPPLIER_REQUIRE_VERIFIED ?? '0').toLowerCase());
  // по умолчанию НЕ требуем verified жёстко (база может быть пустой),
  // но сортируем verified выше. Жёстко: SUPPLIER_REQUIRE_VERIFIED=1
  const strictVerified = opts.requireVerified === true
    || ['1', 'true', 'on'].includes(String(process.env.SUPPLIER_REQUIRE_VERIFIED || '').toLowerCase());

  const allowCityFallback = opts.allowCityFallback === true
    || ['1', 'true', 'on'].includes(String(process.env.SUPPLIER_ALLOW_CITY_FALLBACK || '').toLowerCase());
  const strictCity = opts.strictCity !== false;

  let list = store.listAll(projectPath, {
    category: query.category,
    city: query.city || null,
    onlyVerified: strictVerified,
  });

  let usedFallback = false;

  // Fallback на другие города — только если явно разрешён
  if (!list.length && query.city && allowCityFallback) {
    list = store.listAll(projectPath, {
      category: query.category,
      onlyVerified: strictVerified,
    });
    usedFallback = true;
  }

  // Если без verified пусто и не strict — покажем непроверенных того же города
  if (!list.length && strictVerified && query.city) {
    list = store.listAll(projectPath, {
      category: query.category,
      city: query.city,
      onlyVerified: false,
    });
  }

  const scored = list.map((s) => {
    const { score, breakdown } = scoreSupplier(s, query);
    return { ...s, _score: score, _breakdown: breakdown };
  });

  // При строгом городе отбрасываем mismatch (на случай fallback)
  let filtered = scored;
  if (query.city && strictCity && !usedFallback) {
    const q = normCity(query.city);
    filtered = scored.filter((s) => normCity(s.city) === q);
  }

  filtered.sort((a, b) => b._score - a._score);

  const limit = opts.limit || 5;
  return {
    ok: true,
    list: filtered.slice(0, limit),
    total: filtered.length,
    usedFallback,
    requireVerified: strictVerified,
  };
}
