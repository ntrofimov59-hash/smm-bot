// agent/outreach/store.js — локальное хранилище кандидатов на партнёрство.
// Источник правды — JSON-файл в проекте. Не авторизует и не отправляет ничего.
//
// Файл: projects/<slug>/outreach/candidates.json
// Формат: { version: 1, updatedAt, candidates: [...] }

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ALLOWED_STATUSES = [
  'found',           // найден, ещё не тронут
  'drafted',         // черновик готов
  'approved',        // пользователь одобрил текст
  'sent',            // отправлено вручную
  'replied',         // ответили
  'meeting',         // встреча/сделка
  'rejected',        // отказались
  'do_not_contact',  // больше не писать никогда
];

const ALLOWED_SEGMENTS = ['venue', 'agency', 'corporate', 'caterer', 'contractor', 'other'];

function outreachDir(projectPath) {
  return path.join(projectPath, 'outreach');
}

function candidatesFile(projectPath) {
  return path.join(outreachDir(projectPath), 'candidates.json');
}

export function loadStore(projectPath) {
  const file = candidatesFile(projectPath);
  if (!fs.existsSync(file)) return { version: 1, updatedAt: null, candidates: [] };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data.candidates)) data.candidates = [];
    return data;
  } catch (e) {
    throw new Error(`outreach/store: невалидный JSON ${file}: ${e.message}`, { cause: e });
  }
}

export function saveStore(projectPath, data) {
  const dir = outreachDir(projectPath);
  fs.mkdirSync(dir, { recursive: true });
  const file = candidatesFile(projectPath);
  const tmp = file + '.tmp';
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Нормализация телефона в E.164 без плюса (для wa.me)
export function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits;
}

function normalizeName(name) {
  return String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Дедуп по phone ИЛИ name+city
export function findDuplicate(store, candidate) {
  const phone = normalizePhone(candidate.phone);
  const name = normalizeName(candidate.name);
  const city = String(candidate.city || '').toLowerCase();

  return store.candidates.find(c => {
    const cp = normalizePhone(c.phone);
    if (phone && cp && phone === cp) return true;
    if (name && normalizeName(c.name) === name &&
        String(c.city || '').toLowerCase() === city) return true;
    return false;
  });
}

export function addCandidate(projectPath, input) {
  const store = loadStore(projectPath);
  const seg = String(input.segment || 'other').toLowerCase();
  if (!ALLOWED_SEGMENTS.includes(seg)) {
    throw new Error(`outreach/store: неизвестный segment "${input.segment}"`);
  }
  const candidate = {
    id: `c-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    name: input.name || '(без названия)',
    segment: seg,
    city: input.city || null,
    country: input.country || null,
    language: input.language || 'ru',
    phone: input.phone || null,
    email: input.email || null,
    website: input.website || null,
    instagram: input.instagram || null,
    telegram: input.telegram || null,
    address: input.address || null,
    source: input.source || 'manual',
    sourceUrl: input.sourceUrl || null,
    notes: input.notes || null,
    score: null,
    status: 'found',
    drafted: null,        // { text, createdAt, lang }
    history: [],
    createdAt: new Date().toISOString(),
    lastContactAt: null,
    followupCount: 0,
  };
  const dup = findDuplicate(store, candidate);
  if (dup) {
    throw new Error(`outreach/store: дубликат — ${dup.name} (${dup.id})`);
  }
  store.candidates.push(candidate);
  saveStore(projectPath, store);
  return candidate;
}

export function updateCandidate(projectPath, id, patch) {
  const store = loadStore(projectPath);
  const idx = store.candidates.findIndex(c => c.id === id);
  if (idx === -1) return null;
  const c = store.candidates[idx];

  if (patch.status !== undefined) {
    if (!ALLOWED_STATUSES.includes(patch.status)) {
      throw new Error(`outreach/store: неизвестный status "${patch.status}"`);
    }
    if (c.status !== patch.status) {
      c.history.push({
        ts: new Date().toISOString(),
        event: 'status_change',
        from: c.status,
        to: patch.status,
      });
      c.status = patch.status;
      if (patch.status === 'sent') {
        c.lastContactAt = new Date().toISOString();
        c.followupCount = (c.followupCount || 0) + 1;
      }
    }
  }
  if (patch.drafted !== undefined) c.drafted = patch.drafted;
  if (patch.score !== undefined) c.score = patch.score;
  if (patch.notes !== undefined) c.notes = patch.notes;

  saveStore(projectPath, store);
  return c;
}

export function getCandidate(projectPath, id) {
  const store = loadStore(projectPath);
  return store.candidates.find(c => c.id === id) || null;
}

export function listCandidates(projectPath, filter = {}) {
  const store = loadStore(projectPath);
  let list = store.candidates;
  if (filter.status) list = list.filter(c => c.status === filter.status);
  if (filter.segment) list = list.filter(c => c.segment === filter.segment);
  if (filter.city) list = list.filter(c => c.city === filter.city);
  return list;
}

export function markDoNotContact(projectPath, id, reason = null) {
  return updateCandidate(projectPath, id, { status: 'do_not_contact', notes: reason });
}

export { ALLOWED_STATUSES, ALLOWED_SEGMENTS };
