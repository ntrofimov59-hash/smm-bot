// agent/outreach/sources/registry.js — что откуда берём клиентов (B2B/B2C)
// status: ready | needs_key | manual | blocked_tos | planned

export const CLIENT_SOURCES = [
  {
    id: 'google_places',
    name: 'Google Places',
    types: ['b2b'],
    status: 'ready',
    needs: ['GOOGLE_PLACES_API_KEY'],
    cities: '*',
    notes: 'Лучший контактный слой (phone, website, rating). regionCode по стране.',
  },
  {
    id: 'twogis',
    name: '2GIS',
    types: ['b2b'],
    status: 'ready',
    needs: [],
    cities: ['yerevan', 'tbilisi', 'moscow', 'spb'], // где 2GIS силён
    notes: 'Хорош для CIS. Без ключа в текущей реализации.',
  },
  {
    id: 'osm',
    name: 'OpenStreetMap / Overpass',
    types: ['b2b'],
    status: 'ready',
    needs: [],
    cities: '*',
    notes: 'Бесплатно, контакты часто пустые → enrich / ручная проверка.',
  },
  {
    id: 'telegram_monitor',
    name: 'Telegram groups/channels',
    types: ['b2c', 'b2b'],
    status: 'ready',
    needs: ['TELEGRAM_MONITOR_SESSION'],
    cities: '*',
    notes: 'B2C заявки + офферы. Нужна подписка userbot на чаты.',
  },
  {
    id: 'manual',
    name: 'manual.json / CLI add',
    types: ['b2b', 'b2c'],
    status: 'ready',
    needs: [],
    cities: '*',
    notes: 'CSV/экспорт с досок, визитки, личные знакомства.',
  },
  {
    id: 'spyur',
    name: 'Spyur.am',
    types: ['b2b'],
    status: 'manual',
    needs: [],
    cities: ['yerevan'],
    notes: 'Автопарсинг отложен. Экспорт → manual.json или Google Places AM.',
  },
  {
    id: 'list_am',
    name: 'List.am',
    types: ['b2c', 'b2b'],
    status: 'manual',
    needs: [],
    cities: ['yerevan'],
    notes: 'ToS — без массового скрапа. Ручной export/import.',
  },
  {
    id: 'ss_ge',
    name: 'SS.ge',
    types: ['b2c', 'b2b'],
    status: 'manual',
    needs: [],
    cities: ['tbilisi'],
    notes: 'То же: manual import.',
  },
  {
    id: 'facebook_groups',
    name: 'Facebook groups',
    types: ['b2c'],
    status: 'blocked_tos',
    needs: [],
    cities: '*',
    notes: 'Нет легального API под чужие группы. Только ручной мониторинг.',
  },
  {
    id: 'instagram_discovery',
    name: 'Instagram (чужие аккаунты)',
    types: ['b2b'],
    status: 'blocked_tos',
    needs: [],
    cities: '*',
    notes: 'Graph API только свои аккаунты. Скрап = бан.',
  },
  {
    id: 'wedding_directories',
    name: 'WeddingWire / TheKnot / local wedding dirs',
    types: ['b2b'],
    status: 'planned',
    needs: [],
    cities: '*',
    notes: 'Часто ToS. Сначала manual; API если появится.',
  },
];

export function listReadySources({ city = null } = {}) {
  return CLIENT_SOURCES.filter((s) => {
    if (s.status !== 'ready') return false;
    if (!city || s.cities === '*') return true;
    return Array.isArray(s.cities) && s.cities.includes(String(city).toLowerCase());
  });
}
