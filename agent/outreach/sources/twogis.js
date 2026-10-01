// agent/outreach/sources/twogis.js — 2GIS Catalog API v3.
// Демо-ключ: platform.2gis.ru/ru/keys (1 мес, ~1000 запросов).
// Ключ: TWOGIS_API_KEY в .env
//
// Особенности:
//   - page_size максимум 10 → пагинируем
//   - name_ex — объект { primary, extension }
//   - демо-тариф: только name/address/id/type, БЕЗ contact_groups (проверено)
//     → контакты добираем через enrich (OSM) или вручную
//   - демо-ключ ограничен 1 регионом (Армения/Грузия/...) — уточняй в ЛК

const SEARCH_API = 'https://catalog.api.2gis.com/3.0/items';

const SEGMENT_QUERIES = {
  venue: ['банкетный зал', 'ресторан', 'отель', 'event-площадка'],
  agency: ['организация мероприятий', 'event-агентство', 'свадебное агентство'],
  caterer: ['кейтеринг', 'выездной ресторан'],
  corporate: ['бизнес-центр', 'конференц-зал'],
  contractor: ['фотограф', 'декоратор', 'ведущий'],
  other: ['организация мероприятий'],
};

const CITY_LOCALE = {
  'ереван': 'ru_AM', 'yerevan': 'ru_AM', 'erevan': 'ru_AM',
  'тбилиси': 'ru_GE', 'tbilisi': 'ru_GE',
  'батуми': 'ru_GE', 'batumi': 'ru_GE',
  'баку': 'ru_AZ', 'baku': 'ru_AZ',
  'прага': 'cs_CZ', 'prague': 'cs_CZ', 'praha': 'cs_CZ',
  'москва': 'ru_RU', 'moscow': 'ru_RU',
  'алматы': 'ru_KZ', 'almaty': 'ru_KZ',
  'ташкент': 'ru_UZ', 'tashkent': 'ru_UZ',
  'бишкек': 'ru_KG', 'bishkek': 'ru_KG',
  'дубай': 'en_AE', 'dubai': 'en_AE',
  'абу-даби': 'en_AE', 'abu dhabi': 'en_AE',
  'доха': 'en_QA', 'doha': 'en_QA',
  'эль-кувейт': 'en_KW', 'kuwait': 'en_KW',
  'манама': 'en_BH', 'manama': 'en_BH',
  'маскат': 'en_OM', 'muscat': 'en_OM',
  'эр-рияд': 'en_SA', 'riyadh': 'en_SA',
  'каир': 'en_EG', 'cairo': 'en_EG',
  'касабланка': 'en_MA', 'casablanca': 'en_MA',
  'марракеш': 'en_MA', 'marrakech': 'en_MA',
};

function pickLocale(city, override = null) {
  if (override) return override;
  const key = String(city || '').toLowerCase().trim();
  return CITY_LOCALE[key] || 'ru_RU';
}

const BASE_FIELDS = [
  'items.point',
  'items.address',
  'items.full_address_name',
  'items.name_ex',
  'items.rubrics',
  'items.reviews',
  'items.type',
].join(',');

function extractName(item) {
  const nx = item.name_ex;
  if (nx && typeof nx === 'object') {
    const primary = nx.primary || '';
    const ext = nx.extension || '';
    return ext ? `${primary} (${ext})` : primary;
  }
  return item.name || item.full_name || '(без названия)';
}

function extractContacts(item) {
  let phone = null, email = null, website = null, instagram = null, telegram = null, whatsapp = null;
  const groups = item.contact_groups || [];
  for (const g of groups) {
    for (const c of (g.contacts || [])) {
      const v = (c.value || c.text || '').trim();
      const u = (c.url || '').trim();
      if (c.type === 'phone' && !phone) phone = v;
      else if (c.type === 'email' && !email) email = v;
      else if (c.type === 'website' && !website) website = u || v;
      else if (c.type === 'instagram' && !instagram) instagram = v || u;
      else if (c.type === 'telegram' && !telegram) telegram = v || u;
      else if (c.type === 'whatsapp' && !whatsapp) whatsapp = v || u;
    }
  }
  return { phone, email, website, instagram, telegram, whatsapp };
}

async function searchByQuery(key, query, city, segment, limit, locale) {
  const PAGE_SIZE = 10;
  const maxPages = Math.ceil(limit / PAGE_SIZE);
  const all = [];
  for (let pg = 1; pg <= maxPages; pg++) {
    const url = new URL(SEARCH_API);
    url.searchParams.set('q', query);
    url.searchParams.set('key', key);
    url.searchParams.set('page', String(pg));
    url.searchParams.set('page_size', String(PAGE_SIZE));
    url.searchParams.set('locale', locale);
    url.searchParams.set('fields', BASE_FIELDS);

    const res = await fetch(url.toString());
    const data = await res.json();
    if (data.meta?.code && data.meta.code !== 200) {
      throw new Error(`twogis: ${data.meta.error?.message || JSON.stringify(data.meta)}`);
    }
    const items = data.result?.items || [];
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
    if (all.length >= limit) break;
    await new Promise(r => setTimeout(r, 250));
  }
  return all.slice(0, limit);
}

/**
 * Поиск через 2GIS.
 * @param {Object} opts
 * @param {string} opts.city
 * @param {string} [opts.segment='venue']
 * @param {string} [opts.query] — если задан, используется вместо segment-запросов
 * @param {number} [opts.limit=30]
 * @param {string} [opts.locale]
 * @param {boolean} [opts.withContacts=true] — отдельный byid для топ-N
 * @param {number} [opts.detailsTop=20] — для скольких первых тянуть контакты
 */
export async function search2GIS(opts = {}) {
  const key = process.env.TWOGIS_API_KEY;
  if (!key) throw new Error('twogis: не задан TWOGIS_API_KEY. platform.2gis.ru/ru/keys');

  const {
    city,
    segment = 'venue',
    query = null,
    limit = 30,
    locale = null,
  } = opts;

  if (!city) throw new Error('twogis: нужен --city');

  const queries = query
    ? [query]
    : (SEGMENT_QUERIES[segment] || SEGMENT_QUERIES.other);

  const useLocale = pickLocale(city, locale);
  const perQuery = Math.max(10, Math.ceil(limit / queries.length));

  const seen = new Set();
  const raw = [];

  for (const q of queries) {
    const full = `${q} ${city}`;
    try {
      const items = await searchByQuery(key, full, city, segment, perQuery, useLocale);
      for (const it of items) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        raw.push(it);
      }
      if (raw.length >= limit) break;
    } catch (e) {
      console.error(`   ⚠️  "${q}": ${e.message}`);
    }
  }

  const cityKey = city.toLowerCase();

  return raw.slice(0, limit).map(item => {
    const contacts = extractContacts(item);

    const rubrics = (item.rubrics || []).map(r => r.name).filter(Boolean);

    return {
      externalId: `2gis:${item.id}`,
      name: extractName(item),
      segment,
      city: cityKey,
      language: 'ru',
      phone: contacts.phone,
      email: contacts.email,
      website: contacts.website,
      instagram: contacts.instagram,
      telegram: contacts.telegram,
      address: item.full_address_name || item.address_name || null,
      source: '2gis',
      sourceUrl: `https://2gis.am/firm/${item.id}`,
      notes: rubrics.length ? `Рубрики: ${rubrics.join(', ')}` : null,
      meta: {
        rubrics,
        rating: item.reviews?.general_rating || null,
        reviewsCount: item.reviews?.general_review_count || 0,
        whatsapp: contacts.whatsapp || null,
      },
    };
  });
}
