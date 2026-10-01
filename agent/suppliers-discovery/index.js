// agent/suppliers-discovery/index.js — авто-наполнение базы поставщиков.
// Источники: Overpass (OSM бизнесы) + Lyzem (Telegram-каналы).
// Все найденные — verified=false. Пользователь потом проверяет.

import * as suppliers from '../suppliers/store.js';
import { CATEGORY_QUERIES, CITIES } from './categories.js';
import { classifyText } from './classify.js';
import { searchOsm } from './osm.js';
import { searchLyzem } from './lyzem.js';

function fillTemplate(s, city) {
  const c = CITIES[city];
  return s.replace('{city}', c.en).replace('{cityRu}', c.ru);
}

async function discoverOsmForCity(p, cityKey, categoryKey) {
  const cfg = CATEGORY_QUERIES[categoryKey];
  if (!cfg?.osmTags?.length) return [];
  const c = CITIES[cityKey];

  const found = await searchOsm({
    lat: c.lat,
    lon: c.lon,
    tags: cfg.osmTags,
    radius: 12000,
    limit: 100,
  });

  return found.map(f => ({
    ...f,
    category: categoryKey,
    city: cityKey,
    country: null,
  }));
}

async function discoverLyzemForCity(cityKey, categoryKey) {
  const cfg = CATEGORY_QUERIES[categoryKey];
  if (!cfg?.lyzem?.length) return [];

  const results = [];
  for (const tpl of cfg.lyzem) {
    const q = fillTemplate(tpl, cityKey);
    try {
      const items = await searchLyzem(q, { limit: 10 });
      for (const it of items) {
        results.push({ ...it, category: categoryKey, city: cityKey });
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 600));
  }
  // Дедуп по username
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.username)) return false;
    seen.add(r.username);
    return true;
  });
}

/**
 * Основной пайплайн для одного города или всех.
 */
export async function discover({
  projectPath,
  cities = null,        // ['yerevan'] или null для всех
  categories = null,    // ['photographers'] или null для всех
  onLog = console.log,
} = {}) {
  const cityList = cities || Object.keys(CITIES);
  const catList = categories || Object.keys(CATEGORY_QUERIES);

  const stats = { osm: 0, lyzem: 0, added: 0, dup: 0, err: 0 };

  for (const cityKey of cityList) {
    if (!CITIES[cityKey]) {
      onLog(`⚠️  неизвестный город: ${cityKey}`);
      continue;
    }
    onLog(`\n🌍 ${CITIES[cityKey].ru} (${cityKey})`); console.error('');

    for (const catKey of catList) {
      if (!CATEGORY_QUERIES[catKey]) continue;

      // --- OSM ---
      try {
        const osm = await discoverOsmForCity(projectPath, cityKey, catKey);
        stats.osm += osm.length;

        for (const item of osm) {
          // OSM редко даёт email/instagram, но если есть — берём
          const cat = classifyText(`${item.name} ${item.tags.join(' ')}`, item.category);
          try {
            suppliers.addSupplier(projectPath, {
              category: cat,
              name: item.name,
              city: cityKey,
              phone: item.phone,
              email: item.email,
              website: item.website,
              instagram: item.instagram,
              telegram: item.telegram,
              notes: item.address ? `Адрес: ${item.address}` : null,
              source: 'osm',
              sourceUrl: item.sourceUrl,
              verified: false,
            });
            stats.added++;
          } catch (e) {
            if (e.message.includes('Дубликат')) stats.dup++;
            else stats.err++;
          }
        }

        if (osm.length) onLog(`   📍 OSM/${catKey}: ${osm.length} найдено`);
      } catch (e) {
        onLog(`   ❌ OSM/${catKey}: ${e.message}`);
      }

      // --- Lyzem ---
      try {
        const lz = await discoverLyzemForCity(cityKey, catKey);
        stats.lyzem += lz.length;

        for (const item of lz) {
          // Lyzem даёт только username, без bio. Кладём как pending —
          // bio подтянется позже через userbot (отдельный шаг).
          try {
            suppliers.addSupplier(projectPath, {
              category: catKey,
              name: item.username,
              city: cityKey,
              telegram: item.username,
              notes: `Lyzem query: ${item.query}`,
              source: 'lyzem',
              sourceUrl: `https://t.me/${item.username}`,
              verified: false,
            });
            stats.added++;
          } catch (e) {
            if (e.message.includes('Дубликат')) stats.dup++;
            else stats.err++;
          }
        }

        if (lz.length) onLog(`   📡 Lyzem/${catKey}: ${lz.length} найдено`);
      } catch (e) {
        onLog(`   ❌ Lyzem/${catKey}: ${e.message}`);
      }
    }
  }

  onLog(`\n✅ Итого: +${stats.added} новых, дубликатов: ${stats.dup}, ошибок: ${stats.err}`);
  return stats;
}
