const HOSTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const UA = 'coucou-suppliers/1.0 (+https://coucou-events.com)';

async function queryOverpass(q) {
  for (const host of HOSTS) {
    const t0 = Date.now();
    try {
      // 25 секунд — Overpass timeout в самом запросе + запас
      const res = await fetch(host, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) {
        console.error(`   ⚠️  ${host.split('/')[2]}: HTTP ${res.status} (${Date.now() - t0}ms)`);
        continue;
      }
      const text = await res.text();
      if (text.startsWith('<')) {
        console.error(`   ⚠️  ${host.split('/')[2]}: вернул XML/HTML`);
        continue;
      }
      console.error(`   ✓ ${host.split('/')[2]} ответил за ${Date.now() - t0}ms`);
      return JSON.parse(text);
    } catch (e) {
      console.error(`   ⚠️  ${host.split('/')[2]}: ${e.message} (${Date.now() - t0}ms)`);
    }
  }
  return { elements: [] };
}

/**
 * Ищет бизнесы в радиусе по OSM-тегам.
 */
export async function searchOsm({ lat, lon, tags, radius = 10000, limit = 100 }) {
  if (!tags?.length) return [];

  const lines = tags
    .map(t => {
      const [k, v] = t.split('=');
      return `  nwr["${k}"="${v}"](around:${radius},${lat},${lon});`;
    })
    .join('\n');

  const query = `[out:json][timeout:25];\n(\n${lines}\n);\nout center tags ${limit};`;

  const data = await queryOverpass(query);
  const els = data.elements || [];

  return els.map(el => {
    const t = el.tags || {};
    const name = t.name || t['name:en'] || t['name:ru'] || null;
    if (!name) return null;

    const addrParts = [t['addr:street'], t['addr:housenumber'], t['addr:city']].filter(Boolean);
    const address = addrParts.length ? addrParts.join(' ') : null;

    return {
      externalId: `osm:${el.type}/${el.id}`,
      name,
      phone: t.phone || t['contact:phone'] || t['contact:mobile'] || t.mobile || null,
      email: t.email || t['contact:email'] || null,
      website: t.website || t['contact:website'] || t.url || null,
      instagram: t.instagram || t['contact:instagram'] || null,
      telegram: t.telegram || t['contact:telegram'] || null,
      address,
      source: 'openstreetmap',
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      tags: [t.amenity, t.shop, t.craft, t.tourism, t.leisure, t.office].filter(Boolean),
    };
  }).filter(Boolean);
}
