// agent/suppliers-discovery/local/list-am.js — парсер list.am
// Категория: "Услуги" → организация праздников, фото, декор и т.д.
//
// ВАЖНО: с серверного IP list.am часто отдаёт 403. Нужен резидентный прокси
// в RESIDENTIAL_PROXY_URL. Иначе половина запросов отвалится.

import { proxiedFetch, hasProxy } from './proxy.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Категории list.am
const CATEGORY_URLS = {
  photographers: 'https://www.list.am/ru/category/145', // Фотоуслуги
  videographers: 'https://www.list.am/ru/category/146', // Видео
  hosts: 'https://www.list.am/ru/category/147',         // Ведущие
  decorators: 'https://www.list.am/ru/category/149',    // Декор
  caterers: 'https://www.list.am/ru/category/156',      // Кейтеринг
  venues: 'https://www.list.am/ru/category/150',        // Площадки
  planners: 'https://www.list.am/ru/category/148',      // Организаторы
  musicians: 'https://www.list.am/ru/category/153',
  djs: 'https://www.list.am/ru/category/152',
};

function parseListAmHtml(html, category) {
  const results = [];

  // Простой regex-парсинг. list.am не имеет API, но HTML стабилен годами.
  // Каждое объявление — <a href="/ru/item/NNN" ...>Title</a>
  // Нужно вытащить: id, title, ссылку, цену, продавца (если есть)

  // Заголовки + ссылки
  const linkRe = /<a[^>]+href="(\/ru\/item\/(\d+)[^"]*)"[^>]*>([^<]+)<\/a>/g;
  let m;
  const seen = new Set();

  while ((m = linkRe.exec(html)) !== null) {
    const [, url, id, rawTitle] = m;
    if (seen.has(id)) continue;
    seen.add(id);

    const title = rawTitle.trim();
    if (!title || title.length < 3) continue;

    results.push({
      externalId: `listam:${id}`,
      name: title,
      category,
      city: 'yerevan',
      country: 'Armenia',
      sourceUrl: `https://www.list.am${url}`,
      source: 'list_am',
      // phone/email появятся при клике в детали — но для списка этого достаточно
    });
  }

  return results;
}

/**
 * Поиск по категории list.am.
 */
export async function searchListAm(category) {
  const url = CATEGORY_URLS[category];
  if (!url) return [];

  if (!hasProxy()) {
    console.error(`   ⚠️  list.am без прокси (RESIDENTIAL_PROXY_URL не задан) — риск 403`);
  }

  try {
    const res = await proxiedFetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru,en;q=0.8',
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      console.error(`   ⚠️  list.am: HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    return parseListAmHtml(html, category);
  } catch (e) {
    console.error(`   ⚠️  list.am: ${e.message}`);
    return [];
  }
}

export const SUPPORTED_CATEGORIES = Object.keys(CATEGORY_URLS);
