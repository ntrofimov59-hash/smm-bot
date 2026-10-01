// agent/outreach/sources/manual.js — загрузка кандидатов из outreach/manual.json
// Формат: [{ name, segment, city, phone, email, instagram, telegram, website, notes }]

import fs from 'fs';
import path from 'path';

export function loadManualCandidates(projectPath) {
  const file = path.join(projectPath, 'outreach', 'manual.json');
  if (!fs.existsSync(file)) return [];
  let arr;
  try {
    arr = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`manual: невалидный JSON ${file}: ${e.message}`, { cause: e });
  }
  if (!Array.isArray(arr)) throw new Error('manual: ожидается массив');
  return arr.map(c => ({
    name: c.name || '(без названия)',
    segment: c.segment || 'other',
    city: c.city || null,
    country: c.country || null,
    language: c.language || 'ru',
    phone: c.phone || null,
    email: c.email || null,
    website: c.website || null,
    instagram: c.instagram || null,
    telegram: c.telegram || null,
    address: c.address || null,
    notes: c.notes || null,
    source: 'manual_file',
    sourceUrl: null,
  }));
}
