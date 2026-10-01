// agent/suppliers-discovery/local/index.js — диспетчер локальных досок по городам.

import { searchListAm, SUPPORTED_CATEGORIES as LIST_AM_CATEGORIES } from './list-am.js';
import { filterByQuality } from './quality.js';

// Маппинг: город → { адаптер, категории }
const CITY_ADAPTERS = {
  yerevan: { name: 'list.am', fn: searchListAm, categories: LIST_AM_CATEGORIES },
  // Остальные добавим по мере готовности:
  // tbilisi: { name: 'mymarket.ge', fn: searchMyMarket, categories: [...] },
  // prague: { name: 'bazos.cz', fn: searchBazos, categories: [...] },
  // ...
};

export function getAdapter(city) {
  return CITY_ADAPTERS[city] || null;
}

export function listSupportedCities() {
  return Object.keys(CITY_ADAPTERS);
}

/**
 * Обойти одну площадку (город × категория) с фильтром качества.
 */
export async function searchBoard({ city, category, strict = false }) {
  const adapter = getAdapter(city);
  if (!adapter) {
    return { ok: false, error: `no adapter for city=${city}`, passed: [], rejected: [] };
  }

  if (!adapter.categories.includes(category)) {
    return { ok: false, error: `category ${category} not supported by ${adapter.name}`, passed: [], rejected: [] };
  }

  const raw = await adapter.fn(category);

  // Прогоняем через фильтр
  const { passed, rejected } = filterByQuality(raw, { strict });

  return {
    ok: true,
    board: adapter.name,
    found: raw.length,
    passed,
    rejected,
  };
}
