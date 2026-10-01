// agent/outreach/enrich.js — обогащение карточки кандидата контактами.
// Ищет по имени в Overpass/OSM, добавляет что найдёт.
// 2GIS демо-тариф контакты не отдаёт — используем OSM.

import { geocodeCity } from './sources/overpass.js';

const OVERPASS_HOSTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const UA = 'coucou-outreach/1.0 (+https://coucou-events.com)';

async function overpassQuery(query) {
  for (const host of OVERPASS_HOSTS) {
    try {
      const res = await fetch(host, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.startsWith('<')) continue;
      return JSON.parse(text);
    } catch { /* try next */ }
  }
  throw new Error('overpass: все хосты упали');
}

function normalise(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

async function findByOsm(candidate) {
  if (!candidate.city) return null;

  let geo;
  try { geo = await geocodeCity(candidate.city); }
  catch { return null; }

  const namePart = candidate.name.split('(')[0].trim();
  if (!namePart || namePart.length < 3) return null;

  const safeName = namePart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const query = `[out:json][timeout:25];
(
  nwr["name"~"${safeName}",i](around:15000,${geo.lat},${geo.lon});
  nwr["name:en"~"${safeName}",i](around:15000,${geo.lat},${geo.lon});
);
out center tags 20;`;

  let data;
  try { data = await overpassQuery(query); }
  catch { return null; }

  const els = data.elements || [];
  if (!els.length) return null;

  const target = normalise(namePart);
  let best = null, bestScore = 0;
  for (const el of els) {
    const t = el.tags || {};
    const n = normalise(t.name || t['name:en'] || t['name:ru']);
    if (!n) continue;

    let score;
    if (n === target) score = 100;
    else if (n.includes(target) || target.includes(n)) score = 70;
    else continue;

    const phone = t.phone || t['contact:phone'] || t['contact:mobile'] || t.mobile || null;
    const website = t.website || t['contact:website'] || t.url || null;
    const email = t.email || t['contact:email'] || null;
    const instagram = t.instagram || t['contact:instagram'] || null;
    if (phone) score += 20;
    if (website) score += 10;
    if (score > bestScore) {
      bestScore = score;
      best = { phone, website, email, instagram, source: `osm:${el.type}/${el.id}` };
    }
  }

  return best;
}

export async function enrichCandidate(candidate) {
  const result = { ok: false, updated: {} };

  const osm = await findByOsm(candidate);
  if (osm) {
    if (osm.phone && !candidate.phone) result.updated.phone = osm.phone;
    if (osm.website && !candidate.website) result.updated.website = osm.website;
    if (osm.email && !candidate.email) result.updated.email = osm.email;
    if (osm.instagram && !candidate.instagram) result.updated.instagram = osm.instagram;
    result.ok = Object.keys(result.updated).length > 0;
    result.source = osm.source;
  }

  return result;
}
