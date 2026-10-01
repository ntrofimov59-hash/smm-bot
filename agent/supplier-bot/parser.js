// agent/supplier-bot/parser.js — «нужен фотограф в Ереване» → {category, city, ...}

const CATEGORY_KEYWORDS = {
  photographers: ['фотограф', 'фотки', 'фотос', 'photo', 'shooter'],
  videographers: ['видеограф', 'видеос', 'video', 'клипмейк'],
  caterers: ['кейтеринг', 'кейтер', 'catering', 'еда', 'питание', 'повар', 'банкетное меню'],
  decorators: ['декор', 'декоратор', 'decor'],
  florists: ['флорист', 'цветы', 'букет', 'flower'],
  djs: ['диджей', 'д[ие]джей', ' dj ', 'dj ', ' dj'],
  hosts: ['ведущ', 'тамада', 'host', ' mc '],
  musicians: ['музык', 'группа', 'band', 'живая музыка', 'саксофон', 'гитар'],
  makeup: ['визажист', 'макияж', 'стилист', 'makeup', 'причёск'],
  transfer: ['трансфер', 'такси', 'transfer', 'автобус для гостей'],
  venues: ['площадк', 'venue', 'зал', 'банкетн', 'локаци', 'ресторан', 'место проведения'],
  planners: ['организатор', 'planner', 'планировщик', 'координатор'],
  rental: ['шатёр', 'шатер', 'аренда', 'rental', 'мебель', 'звук'],
  entertainers: ['аниматор', 'шоу', 'fire show', 'артист'],
};

const CITY_KEYWORDS = {
  yerevan: ['ереван', 'yerevan', 'erevan', 'ереване'],
  tbilisi: ['тбилиси', 'tbilisi'],
  bali: ['бали', 'bali', 'ченггу', 'canggu', 'уbud', 'ubud'],
  phuket: ['пхукет', 'phuket'],
  prague: ['прага', 'прагу', 'праге', 'prague', 'praha'],
  barcelona: ['барселона', 'barcelona'],
  marrakech: ['марракеш', 'marrakech'],
  casablanca: ['касабланка', 'casablanca'],
  danang: ['дананг', 'danang', 'да нанг'],
  nha_trang: ['нячанг', 'nha trang', 'nhatrang'],
};

export function parseQuery(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';

  let category = null;
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    if (kws.some(k => new RegExp(k, 'i').test(t))) {
      category = cat;
      break;
    }
  }

  let city = null;
  for (const [c, kws] of Object.entries(CITY_KEYWORDS)) {
    if (kws.some(k => t.includes(k))) { city = c; break; }
  }

  let guests = null;
  const gm = t.match(/(\d{1,4})\s*(гост|человек|people|guest|persons)/);
  if (gm) guests = Number(gm[1]);

  return { category, city, guests, raw: text };
}
