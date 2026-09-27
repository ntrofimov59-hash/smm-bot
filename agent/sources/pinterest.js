// agent/sources/pinterest.js — извлекает ссылки на картинки с публичной Pinterest-доски
//
// Подход: Pinterest рендерит доску как HTML с вкраплениями JSON (`__PWS_DATA__`),
// а также кладёт картинки в CDN `i.pinimg.com`. Мы не полагаемся на конкретную
// схему JSON (она меняется) — собираем все уникальные ссылки на i.pinimg.com
// из HTML + пробуем вытащить pin id для дедупа.
//
// Не требует логина. Работает для публичных досок.
// ⚠️ Нарушает ToS Pinterest при агрессивном использовании. Не долбить.

const PINIMG_RE = /https:\/\/i\.pinimg\.com\/[^"'\s<>]+/g;
const PIN_ID_RE = /\/pin\/(\d+)\//;

function normalizeCdnUrl(url) {
  // У Pinterest до 5 размеров одного пина: /originals/, /736x/, /564x/, /474x/, /236x/
  // Стандартизируем на 736x (хороший баланс качество/вес). Если нет — берём как есть.
  return url
    .replace('i.pinimg.com/236x', 'i.pinimg.com/736x')
    .replace('i.pinimg.com/474x', 'i.pinimg.com/736x')
    .replace('i.pinimg.com/564x', 'i.pinimg.com/736x')
    .replace('i.pinimg.com/originals', 'i.pinimg.com/736x');
}

/**
 * Парсит HTML Pinterest-доски и возвращает уникальные imageUrl.
 * @param {string} html
 * @param {{ limit?: number }} opts
 * @returns {Array<{ imageUrl: string, sourceId: string|null }>}
 */
export function parsePinterestHtml(html, { limit = 30 } = {}) {
  if (!html || typeof html !== 'string') return [];

  const seen = new Set();
  const results = [];

  // 1. Основной путь — все i.pinimg.com/... в HTML
  const matches = html.match(PINIMG_RE) || [];
  for (const raw of matches) {
    const url = normalizeCdnUrl(raw);
    if (seen.has(url)) continue;

    // отбрасываем явные иконки/аватары (маленькие картинки, /user/ в пути)
    if (/\/user\//.test(url)) continue;
    if (/\/75x75_RS\//.test(url)) continue;

    seen.add(url);
    const pinIdMatch = url.match(PIN_ID_RE) || raw.match(PIN_ID_RE);
    results.push({
      imageUrl: url,
      sourceId: pinIdMatch ? pinIdMatch[1] : null,
    });

    if (results.length >= limit) break;
  }

  return results;
}

/**
 * Скачивает HTML Pinterest-доски и парсит его.
 *
 * @param {string} boardUrl — https://www.pinterest.com/<user>/<board>/
 * @param {{ limit?: number, fetchImpl?: Function, timeoutMs?: number }} opts
 * @returns {Promise<Array<{ imageUrl: string, sourceId: string|null }>>}
 */
export async function fetchPinterestBoard(boardUrl, opts = {}) {
  const {
    limit = 30,
    fetchImpl = fetch,
    timeoutMs = 20_000,
  } = opts;

  if (!boardUrl || !/^https:\/\/(www\.)?pinterest\.[a-z.]+\//.test(boardUrl)) {
    throw new Error('pinterest: некорректный board URL');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(boardUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; smm-bot/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) throw new Error(`pinterest: HTTP ${res.status}`);

    const html = await res.text();
    const pins = parsePinterestHtml(html, { limit });

    return pins.map(p => ({
      ...p,
      source: 'pinterest',
      sourceUrl: boardUrl,
    }));
  } finally {
    clearTimeout(timer);
  }
}
