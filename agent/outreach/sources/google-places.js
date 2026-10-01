// agent/outreach/sources/google-places.js — поиск площадок/агентств через Google Places.
// Использует Places API v1 (searchText).
// Ключ: GOOGLE_PLACES_API_KEY в .env

const API = 'https://places.googleapis.com/v1/places:searchText';

/**
 * @param {string} query — например "wedding venue Yerevan"
 * @param {Object} opts
 * @param {number} [opts.limit=20]
 * @param {string} [opts.languageCode='ru']
 * @param {string} [opts.regionCode]   — например 'AM'
 * @param {string} [opts.city]         — для проставления в кандидатах
 * @param {string} [opts.segment='venue']
 */
export async function searchGooglePlaces(query, opts = {}) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error('google-places: не задан GOOGLE_PLACES_API_KEY');

  const {
    limit = 20,
    languageCode = 'ru',
    regionCode = null,
    city = null,
    segment = 'venue',
  } = opts;

  const body = {
    textQuery: query,
    maxResultCount: Math.min(limit, 20),
    languageCode,
  };
  if (regionCode) body.regionCode = regionCode;

  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.internationalPhoneNumber',
    'places.nationalPhoneNumber',
    'places.websiteUri',
    'places.rating',
    'places.userRatingCount',
    'places.types',
    'places.primaryType',
    'places.googleMapsUri',
    'places.businessStatus',
  ].join(',');

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || JSON.stringify(data);
    throw new Error(`google-places: ${res.status} ${msg}`);
  }

  const places = data.places || [];
  return places
    .filter(p => p.businessStatus !== 'CLOSED_PERMANENTLY')
    .map(p => ({
      externalId: p.id,
      name: p.displayName?.text || '(без названия)',
      address: p.formattedAddress || null,
      phone: p.internationalPhoneNumber || p.nationalPhoneNumber || null,
      website: p.websiteUri || null,
      instagram: null,
      telegram: null,
      email: null,
      city,
      segment,
      source: 'google_places',
      sourceUrl: p.googleMapsUri || null,
      meta: {
        rating: p.rating || null,
        userRatingCount: p.userRatingCount || 0,
        types: p.types || [],
      },
    }));
}
