// agent/suppliers/fetch-geo.js — наполнение suppliers из OSM / 2GIS
// Только указанный city. verified: false до ручной проверки.

import * as store from './store.js';
import { searchOverpass } from '../outreach/sources/overpass.js';
import { search2GIS } from '../outreach/sources/twogis.js';

// outreach segment → supplier category

const CAT_TO_OSM_SEGMENT = {
  venues: 'venue',
  planners: 'agency',
  caterers: 'caterer',
  photographers: 'contractor',
  florists: 'contractor',
  decorators: 'contractor',
};

function toSupplierInput(c, category, city, source) {
  return {
    name: c.name,
    category,
    city: city.toLowerCase(),
    phone: c.phone || undefined,
    email: c.email || undefined,
    website: c.website || undefined,
    instagram: c.instagram || undefined,
    telegram: c.telegram || undefined,
    source,
    sourceUrl: c.sourceUrl || undefined,
    verified: false,
    tags: ['auto', source],
    notes: c.address ? `addr: ${c.address}` : undefined,
  };
}

export async function fetchSuppliersGeo(projectPath, {
  city,
  category = 'venues',
  source = 'osm', // osm | 2gis | both
  limit = 40,
  onLog = console.log,
} = {}) {
  if (!city) throw new Error('нужен city');
  if (!category) throw new Error('нужен category');

  const segment = CAT_TO_OSM_SEGMENT[category] || 'venue';
  const found = [];

  if (source === 'osm' || source === 'both') {
    onLog(`🌍 OSM ${city} / ${category} (${segment})...`);
    try {
      const list = await searchOverpass({ city, segment, limit });
      found.push(...list.map((c) => ({ ...c, _src: 'openstreetmap' })));
    } catch (e) {
      onLog(`OSM error: ${e.message}`);
    }
  }

  if (source === '2gis' || source === 'both') {
    onLog(`🗺  2GIS ${city} / ${category}...`);
    try {
      const list = await search2GIS({ city, segment, limit });
      found.push(...list.map((c) => ({ ...c, _src: '2gis' })));
    } catch (e) {
      onLog(`2GIS error: ${e.message}`);
    }
  }

  let added = 0, dup = 0, err = 0;
  for (const c of found.slice(0, limit)) {
    const input = toSupplierInput(c, category, city, c._src);
    try {
      store.addSupplier(projectPath, input);
      added++;
    } catch (e) {
      if (/[Дд]убликат/.test(e.message)) dup++;
      else { err++; onLog(`  ! ${c.name}: ${e.message}`); }
    }
  }

  return { found: found.length, added, dup, err };
}
