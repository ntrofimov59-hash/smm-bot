// agent/outreach/sources/overpass.js — OpenStreetMap через Overpass API.
// Использует несколько инстансов с автопереключением при 504/429/5xx.
// Nominatim для геокодинга города с кэшем.

import fs from 'fs';
import path from 'path';
import os from 'os';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

// Несколько Overpass-инстансов — переключаемся при ошибке
const OVERPASS_HOSTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const UA = 'coucou-outreach/1.0 (+https://coucou-events.com)';

const CACHE_DIR = path.join(os.tmpdir(), 'smm-outreach-cache');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function cachePath(city) {
  return path.join(CACHE_DIR, `geo-${city.toLowerCase().replace(/\s+/g, '_')}.json`);
}

function readCache(city) {
  const f = cachePath(city);
  if (!fs.existsSync(f)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Date.now() - d.cachedAt > CACHE_TTL_MS) return null;
    return d;
  } catch { return null; }
}

function writeCache(city, data) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath(city), JSON.stringify({ ...data, cachedAt: Date.now() }));
}

export async function geocodeCity(city, country = null) {
  const cached = readCache(city + (country || ''));
  if (cached) return cached;

  const q = country ? `${city}, ${country}` : city;
  const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=1`;

  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`nominatim: ${res.status}`);
  const arr = await res.json();
  if (!arr.length) throw new Error(`nominatim: город не найден "${q}"`);

  const r = arr[0];
  const result = { lat: Number(r.lat), lon: Number(r.lon), displayName: r.display_name };
  writeCache(city + (country || ''), result);
  return result;
}

const SEGMENT_TAGS = {
  venue: ['amenity=events_venue', 'tourism=hotel', 'amenity=restaurant', 'leisure=amusement_arcade'],
  agency: ['office=travel_agent', 'shop=travel_agency', 'office=event_management'],
  caterer: ['shop=catering', 'amenity=restaurant', 'amenity=cafe'],
  corporate: ['office=company', 'office=it', 'office=consulting'],
  contractor: ['craft=photographer', 'craft=caterer', 'shop=florist', 'craft=decorator'],
  other: ['amenity=events_venue'],
};

function buildOverpassQuery(lat, lon, radius, tags) {
  const filterLines = tags
    .map(t => {
      const [k, v] = t.split('=');
      return `  nwr["${k}"="${v}"](around:${radius},${lat},${lon});`;
    })
    .join('\n');
  return `[out:json][timeout:25];\n(\n${filterLines}\n);\nout body center 200;`;
}

function extractCandidate(el, cityName, segment) {
  const t = el.tags || {};
  const name = t.name || t['name:en'] || t['name:ru'] || t['name:hy'] || null;
  if (!name) return null;

  const phone = t.phone || t['contact:phone'] || t['contact:mobile'] || t.mobile || null;
  const website = t.website || t['contact:website'] || t.url || null;
  const email = t.email || t['contact:email'] || null;
  const instagram = t.instagram || t['contact:instagram'] || null;
  const telegram = t.telegram || t['contact:telegram'] || null;

  const addrParts = [t['addr:street'], t['addr:housenumber'], t['addr:city']].filter(Boolean);
  const address = addrParts.length ? addrParts.join(' ') : null;

  return {
    externalId: `osm:${el.type}/${el.id}`,
    name, segment, city: cityName,
    language: t['name:ru'] ? 'ru' : (t['name:hy'] ? 'hy' : 'en'),
    phone, email, website, instagram, telegram, address,
    source: 'openstreetmap',
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    meta: { osmType: el.type, osmId: el.id, types: [t.amenity, t.tourism, t.shop, t.office, t.craft, t.leisure].filter(Boolean) },
  };
}

// Пауза для rate-limit
let lastCallAt = 0;
async function waitRate() {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < 11000) await new Promise(r => setTimeout(r, 11000 - elapsed));
  lastCallAt = Date.now();
}

async function queryOverpassOnce(host, query) {
  const res = await fetch(host, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.startsWith('<')) throw new Error(`Overpass вернул HTML/XML (${text.slice(0, 80)})`);
  return JSON.parse(text);
}

async function queryOverpass(query) {
  let lastErr = null;
  for (const host of OVERPASS_HOSTS) {
    try {
      console.error(`   🌐 ${host.split('/')[2]} ...`);
      const data = await queryOverpassOnce(host, query);
      return data;
    } catch (e) {
      console.error(`   ⚠️  ${e.message}, пробую следующий...`);
      lastErr = e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error(`overpass: все хосты упали. Последняя ошибка: ${lastErr?.message}`);
}

export async function searchOverpass(opts = {}) {
  const {
    city, country = null, segment = 'venue', tags = null,
    radius = 8000, limit = 100,
  } = opts;
  if (!city) throw new Error('overpass: нужен --city');

  const useTags = tags && tags.length ? tags : (SEGMENT_TAGS[segment] || SEGMENT_TAGS.other);
  const geo = await geocodeCity(city, country);
  console.error(`   📍 ${geo.displayName} (${geo.lat.toFixed(3)}, ${geo.lon.toFixed(3)})`);

  await waitRate();
  const query = buildOverpassQuery(geo.lat, geo.lon, radius, useTags);
  const data = await queryOverpass(query);
  const elements = data.elements || [];

  return elements
    .map(el => extractCandidate(el, city.toLowerCase(), segment))
    .filter(Boolean)
    .slice(0, limit);
}
