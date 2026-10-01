// agent/outreach/links.js — генерирует ссылки для ручной отправки.
// Ничего не отправляет. Даёт пользователю один клик.

import { normalizePhone } from './store.js';

function igCleanup(handle) {
  if (!handle) return null;
  let h = String(handle).trim();
  h = h.replace(/^@/, '');
  // отрезать URL, если передали полный
  const m = h.match(/instagram\.com\/([^/?#]+)/i);
  if (m) h = m[1];
  if (!/^[A-Za-z0-9._]+$/.test(h)) return null;
  return h;
}

function tgCleanup(handle) {
  if (!handle) return null;
  let h = String(handle).trim().replace(/^@/, '');
  const m = h.match(/(?:t\.me|telegram\.me)\/([A-Za-z0-9_]+)/i);
  if (m) h = m[1];
  if (!/^[A-Za-z0-9_]{4,}$/.test(h)) return null;
  return h;
}

export function buildLinks(candidate, draftText = null) {
  const links = {};
  const phone = normalizePhone(candidate.phone);

  if (phone) {
    const base = `https://wa.me/${phone}`;
    links.whatsapp = draftText
      ? `${base}?text=${encodeURIComponent(draftText)}`
      : base;
  }

  const tg = tgCleanup(candidate.telegram);
  if (tg) links.telegram = `https://t.me/${tg}`;

  const ig = igCleanup(candidate.instagram);
  if (ig) links.instagram = `https://instagram.com/${ig}`;

  if (candidate.email) {
    const subject = encodeURIComponent('Сотрудничество с Coucou Events');
    const body = draftText ? encodeURIComponent(draftText) : '';
    links.email = `mailto:${candidate.email}?subject=${subject}&body=${body}`;
  }

  if (candidate.website) links.website = candidate.website;

  return links;
}

export { igCleanup, tgCleanup };
