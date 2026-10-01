// agent/suppliers-discovery/categories.js — маппинг категорий на источники.
// Для каждого города обходим эти категории.

export const CATEGORY_QUERIES = {
  photographers: {
    osmTags: ['craft=photographer', 'shop=photo'],
    lyzem: ['{city} photographer', 'фотограф {cityRu}', 'свадебный фотограф {cityRu}', '{city} wedding photographer'],
    hints: [/photograph|фотограф/i],
  },
  videographers: {
    osmTags: ['craft=videographer', 'craft=photographer'], // OSM редко разделяет
    lyzem: ['{city} videographer', 'видеограф {cityRu}', '{city} video'],
    hints: [/video|видео/i],
  },
  caterers: {
    osmTags: ['shop=catering', 'amenity=restaurant', 'amenity=banquet_hall'],
    lyzem: ['кейтеринг {cityRu}', '{city} catering', '{cityRu} банкет'],
    hints: [/cater|кейтеринг|банкет|питан/i],
  },
  decorators: {
    osmTags: ['craft=decorator', 'shop=interior_decoration'],
    lyzem: ['декор {cityRu}', '{city} wedding decor', '{city} event decor'],
    hints: [/decor|декор|оформлен/i],
  },
  florists: {
    osmTags: ['shop=florist', 'craft=florist'],
    lyzem: ['флорист {cityRu}', '{city} florist', 'цветы {cityRu}', '{city} wedding flowers'],
    hints: [/flower|flor|флор|цвет/i],
  },
  djs: {
    osmTags: [], // редко в OSM
    lyzem: ['dj {cityRu}', '{city} wedding dj', 'диджей {cityRu}'],
    hints: [/\bdj\b|диджей/i],
  },
  hosts: {
    osmTags: [],
    lyzem: ['ведущий {cityRu}', '{city} wedding host', 'тамада {cityRu}'],
    hints: [/ведущ|тамада|\bhost\b|\bmc\b/i],
  },
  musicians: {
    osmTags: [],
    lyzem: ['музыканты {cityRu}', '{city} live band', 'живая музыка {cityRu}'],
    hints: [/band|музык|sax|гитар/i],
  },
  makeup: {
    osmTags: ['shop=beauty', 'amenity=beauty_salon'],
    lyzem: ['визажист {cityRu}', '{city} makeup artist', 'стилист {cityRu}'],
    hints: [/makeup|визаж|stylist|стилист|hair/i],
  },
  transfer: {
    osmTags: ['amenity=car_rental', 'shop=car_rental'],
    lyzem: ['трансфер {cityRu}', '{city} transfer', '{city} taxi wedding'],
    hints: [/transfer|трансфер|такси|chauffeur/i],
  },
  venues: {
    osmTags: ['amenity=events_venue', 'amenity=banquet_hall', 'tourism=hotel', 'amenity=restaurant'],
    lyzem: ['площадка {cityRu}', '{city} wedding venue', 'банкетный зал {cityRu}', 'свадебная площадка {cityRu}'],
    hints: [/venue|площадк|банкетн|зал|ресторан|hotel|отель/i],
  },
  planners: {
    osmTags: ['office=event_management', 'shop=wedding'],
    lyzem: ['организатор свадеб {cityRu}', '{city} wedding planner', 'event agency {city}'],
    hints: [/wedding|planner|организатор|events agency/i],
  },
  rental: {
    osmTags: ['shop=party_rental', 'rental=tent'],
    lyzem: ['аренда шатра {cityRu}', '{city} tent rental', 'аренда мебели {cityRu}'],
    hints: [/rental|аренд|tent|шатёр|шатер/i],
  },
  entertainers: {
    osmTags: [],
    lyzem: ['аниматор {cityRu}', '{city} fire show', '{city} entertainment'],
    hints: [/аниматор|entertain|шоу|fire show/i],
  },
};

// Город → { lat, lon, ru, en } — координаты для Overpass + названия для Lyzem
export const CITIES = {
  yerevan:    { ru: 'Ереван',    en: 'Yerevan',    lat: 40.1872, lon: 44.5152 },
  tbilisi:    { ru: 'Тбилиси',   en: 'Tbilisi',    lat: 41.7151, lon: 44.8271 },
  bali:       { ru: 'Бали',      en: 'Bali',       lat: -8.6500, lon: 115.2167 },
  phuket:     { ru: 'Пхукет',    en: 'Phuket',     lat: 7.8804,  lon: 98.3923 },
  prague:     { ru: 'Прага',     en: 'Prague',     lat: 50.0755, lon: 14.4378 },
  barcelona:  { ru: 'Барселона', en: 'Barcelona',  lat: 41.3851, lon: 2.1734 },
  marrakech:  { ru: 'Марракеш',  en: 'Marrakech',  lat: 31.6295, lon: -7.9811 },
  casablanca: { ru: 'Касабланка', en: 'Casablanca', lat: 33.5731, lon: -7.5898 },
  danang:     { ru: 'Дананг',    en: 'Da Nang',    lat: 16.0544, lon: 108.2022 },
  nha_trang:  { ru: 'Нячанг',    en: 'Nha Trang',  lat: 12.2388, lon: 109.1967 },
  antalya:    { ru: 'Анталья',   en: 'Antalya',    lat: 36.8969, lon: 30.7133 },
  belgrade:   { ru: 'Белград',   en: 'Belgrade',   lat: 44.7866, lon: 20.4489 },
  budapest:   { ru: 'Будапешт',  en: 'Budapest',   lat: 47.4979, lon: 19.0402 },
  goa:        { ru: 'Гоа',       en: 'Goa',        lat: 15.2993, lon: 74.1240 },
  srilanka:   { ru: 'Шри-Ланка', en: 'Sri Lanka',  lat: 7.8731,  lon: 80.7718 },
};
