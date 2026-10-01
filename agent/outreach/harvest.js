// agent/outreach/harvest.js — мульти-источник сбор B2B-клиентов по городу
import fs from 'fs';
import path from 'path';
import * as store from './store.js';
import { searchGooglePlaces } from './sources/google-places.js';
import { search2GIS } from './sources/twogis.js';
import { searchOverpass } from './sources/overpass.js';
import { listReadySources } from './sources/registry.js';

function loadQueries(projectPath) {
  const f = path.join(projectPath, 'outreach', 'client-queries.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function addAll(projectPath, list, stats, sourceTag) {
  for (const c of list) {
    try {
      store.addCandidate(projectPath, { ...c, source: c.source || sourceTag });
      stats.added++;
    } catch (e) {
      if (/дубликат/i.test(String(e.message))) stats.dup++;
      else {
        stats.err++;
        stats.errors.push(`${c.name}: ${e.message}`);
      }
    }
  }
}

/**
 * @param {string} projectPath
 * @param {{ city: string, segments?: string[], sources?: string[], limitPerQuery?: number, onLog?: fn }} opts
 */
export async function harvestClients(projectPath, opts = {}) {
  const {
    city,
    segments = ['venue', 'agency'],
    sources = null, // null = all ready
    limitPerQuery = 15,
    onLog = console.log,
  } = opts;

  if (!city) throw new Error('harvest: нужен city');

  const cfg = loadQueries(projectPath);
  const cityMeta = cfg?.cities?.[city.toLowerCase()] || {};
  const ready = listReadySources({ city });
  const want = new Set(
    (sources || ready.map((s) => s.id)).map((s) => String(s).toLowerCase())
  );

  const stats = {
    city,
    segments,
    added: 0,
    dup: 0,
    err: 0,
    errors: [],
    bySource: {},
  };

  for (const seg of segments) {
    const segCfg = cfg?.segments?.[seg] || {
      google: [`${seg} ${city}`],
      osm_segment: seg,
      twogis_segment: seg,
    };

    // Google Places
    if (want.has('google_places') && process.env.GOOGLE_PLACES_API_KEY) {
      const queries = segCfg.google || [];
      for (const q of queries) {
        const query = `${q} ${city}${cityMeta.country ? ' ' + cityMeta.country : ''}`;
        onLog(`🔍 Places: ${query}`);
        try {
          const found = await searchGooglePlaces(query, {
            city: city.toLowerCase(),
            segment: seg === 'hotel' ? 'venue' : seg,
            limit: limitPerQuery,
            regionCode: cityMeta.regionCode || null,
          });
          stats.bySource.google_places = (stats.bySource.google_places || 0) + found.length;
          addAll(projectPath, found, stats, 'google_places');
        } catch (e) {
          onLog(`   ⚠️ Places: ${e.message}`);
          stats.err++;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    } else if (want.has('google_places')) {
      onLog('⏭ Google Places: нет GOOGLE_PLACES_API_KEY');
    }

    // 2GIS
    if (want.has('twogis')) {
      onLog(`🏙  2GIS: ${city} / ${seg}`);
      try {
        const found = await search2GIS({
          city: city.toLowerCase(),
          segment: segCfg.twogis_segment || seg,
          limit: limitPerQuery * 2,
        });
        stats.bySource.twogis = (stats.bySource.twogis || 0) + found.length;
        addAll(projectPath, found, stats, '2gis');
      } catch (e) {
        onLog(`   ⚠️ 2GIS: ${e.message}`);
      }
    }

    // OSM
    if (want.has('osm')) {
      onLog(`🌍 OSM: ${city} / ${seg}`);
      try {
        const found = await searchOverpass({
          city: city.toLowerCase(),
          country: cityMeta.country || null,
          segment: segCfg.osm_segment || seg,
          limit: limitPerQuery * 3,
        });
        stats.bySource.osm = (stats.bySource.osm || 0) + found.length;
        addAll(projectPath, found, stats, 'openstreetmap');
      } catch (e) {
        onLog(`   ⚠️ OSM: ${e.message}`);
      }
    }
  }

  return stats;
}
