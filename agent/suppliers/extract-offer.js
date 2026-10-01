// agent/suppliers/extract-offer.js — из текста сообщения/объявления → черновик поставщика
// Не ходит в сеть. Только эвристики под event/wedding направление.

import { parseQuery } from '../supplier-bot/parser.js';

const OFFER_HINTS = [
  /я\s+(фотограф|видеограф|ведущ|диджей|флорист|декоратор|визажист|организатор)/i,
  /мы\s+(делаем|организуем|снимаем|украшаем)/i,
  /(услуги|прайс|портфолио|бронь|записываю|работаю)\b/i,
  /\b(photographer|videographer|wedding\s*dj|florist|catering|event\s*planner)\b/i,
  /(сдам|сдаём|аренда)\s+(зал|площадк|шат[её]р|локаци)/i,
];

const PHONE_RE = /(?:\+?\d[\d\s\-()]{8,}\d)/g;
const IG_RE = /(?:@|instagram\.com\/)([A-Za-z0-9._]{2,30})/gi;
const TG_RE = /(?:t\.me\/|@)([A-Za-z0-9_]{4,32})/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;

const CATEGORY_TO_SUPPLIER = {
  photographers: 'photographers',
  videographers: 'videographers',
  caterers: 'caterers',
  decorators: 'decorators',
  florists: 'florists',
  djs: 'djs',
  hosts: 'hosts',
  musicians: 'musicians',
  makeup: 'makeup',
  transfer: 'transfer',
  venues: 'venues',
  planners: 'planners',
  rental: 'rental',
  entertainers: 'entertainers',
};

function looksLikeOffer(text) {
  const t = String(text || '');
  if (t.length < 20) return false;
  // заявки клиентов («ищу фотографа») — не оффер
  if (/\b(ищу|нужен|нужна|нужно|looking for|need a)\b/i.test(t) && !OFFER_HINTS.some((r) => r.test(t))) {
    return false;
  }
  return OFFER_HINTS.some((r) => r.test(t));
}

function pickName(text, ig) {
  // «Меня зовут Анна, фотограф» / первая строка
  const m = text.match(/(?:меня зовут|i'?m|мы\s*—)\s*([A-Za-zА-Яа-яЁё\s]{2,40})/i);
  if (m) return m[1].trim().slice(0, 60);
  if (ig) return `@${ig}`;
  const first = text.split(/\n/)[0].replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
  return first.slice(0, 60) || 'TG offer';
}

/**
 * @returns {null | {
 *   name, category, city, phone, instagram, telegram, email, website,
 *   notes, source, sourceUrl, verified, worksWithForeigners
 * }}
 */
export function extractSupplierOffer(text, opts = {}) {
  const raw = String(text || '').trim();
  if (!looksLikeOffer(raw)) return null;

  const parsed = parseQuery(raw);
  const category = CATEGORY_TO_SUPPLIER[parsed.category] || null;
  if (!category) return null;

  const city = opts.city || parsed.city || null;
  // без города не кладём в базу «проверенных по городу» — только если city задан каналом
  if (opts.requireCity !== false && !city) return null;

  const phones = raw.match(PHONE_RE) || [];
  const phone = phones[0] ? phones[0].replace(/[^\d+]/g, '') : null;

  let instagram = null;
  for (const m of raw.matchAll(IG_RE)) {
    const h = m[1];
    if (!/^(me|http|https)$/i.test(h)) { instagram = h; break; }
  }

  let telegram = null;
  for (const m of raw.matchAll(TG_RE)) {
    const h = m[1];
    if (!/^(me|share|joinchat)$/i.test(h)) { telegram = h; break; }
  }

  const emails = raw.match(EMAIL_RE) || [];
  const urls = (raw.match(URL_RE) || []).filter((u) => !/t\.me|instagram\.com|wa\.me/i.test(u));

  if (!phone && !instagram && !telegram && !emails[0]) {
    // без контакта бесполезно
    return null;
  }

  return {
    name: pickName(raw, instagram),
    category,
    city,
    phone: phone || undefined,
    instagram: instagram || undefined,
    telegram: telegram || undefined,
    email: emails[0] || undefined,
    website: urls[0] || undefined,
    notes: raw.slice(0, 400),
    source: opts.source || 'telegram',
    sourceUrl: opts.sourceUrl || undefined,
    verified: false,
    worksWithForeigners: /иностран|foreign|english|expats?/i.test(raw),
    tags: ['auto', opts.source || 'telegram'].filter(Boolean),
  };
}

export { looksLikeOffer };
