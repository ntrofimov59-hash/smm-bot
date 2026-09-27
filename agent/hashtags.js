// agent/hashtags.js — подбирает хештеги из пула проекта + добавляет из vision
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(new URL('./data/', import.meta.url).pathname);
fs.mkdirSync(DATA_DIR, { recursive: true });

const USED_FILE = path.join(DATA_DIR, 'hashtags-used.json');

function loadUsed() {
  try {
    if (fs.existsSync(USED_FILE)) return JSON.parse(fs.readFileSync(USED_FILE, 'utf8'));
  } catch {}
  return { date: '', tags: [] };
}

function saveUsed(data) {
  try {
    fs.writeFileSync(USED_FILE, JSON.stringify(data, null, 2));
  } catch (e) { console.warn('hashtags: save failed:', e.message); }
}

function todayKey() { return new Date().toISOString().slice(0, 10); }

/**
 * Собирает финальный список хештегов с ротацией.
 * @param {Object} opts
 * @param {Object} opts.project — project.json
 * @param {string} opts.city — ключ города (phuket, yerevan...)
 * @param {string} opts.service — 'wedding' | 'corporate' | null
 * @param {string[]} opts.imageTags — теги из vision
 * @param {string[]} opts.llmHashtags — хештеги от LLM
 * @param {number} opts.max — максимум хештегов
 * @returns {string[]}
 */
export function buildHashtags(opts) {
  const {
    project,
    city = '',
    service = null,
    imageTags = [],
    llmHashtags = [],
    max = 12,
  } = opts;

  const cfg = project.hashtags || {};
  const used = loadUsed();
  const today = todayKey();
  if (used.date !== today) { used.date = today; used.tags = []; }

  const usedSet = new Set(used.tags);

  const candidates = [];

  // 1. Всегда добавляем базовые (даже если использовались)
  for (const t of (cfg.base || [])) {
    candidates.push({ tag: t, always: true });
  }

  // 2. Хештеги города — ротация
  const cityTags = cfg.cities?.[city] || [];
  for (const t of cityTags) {
    if (!usedSet.has(t)) candidates.push({ tag: t, priority: 1 });
  }

  // 3. Хештеги услуги — ротация
  if (service && cfg.services?.[service]) {
    for (const t of cfg.services[service]) {
      if (!usedSet.has(t)) candidates.push({ tag: t, priority: 1.5 });
    }
  }

  // 4. Хештеги от LLM — ротация, приоритет выше среднего
  for (const t of llmHashtags) {
    if (!usedSet.has(t)) candidates.push({ tag: t, priority: 2 });
  }

  // 5. Хештеги из vision-тегов (низкий приоритет, но добавляют разнообразия)
  for (const tag of imageTags.slice(0, 5)) {
    const t = `#${tag.replace(/[^a-z0-9]/gi, '')}`;
    if (!usedSet.has(t) && !candidates.find(c => c.tag === t)) {
      candidates.push({ tag: t, priority: 0.5 });
    }
  }

  // Сортируем: always → high priority → остальные
  candidates.sort((a, b) => {
    if (a.always && !b.always) return -1;
    if (b.always && !a.always) return 1;
    return (b.priority || 0) - (a.priority || 0);
  });

  // Дедупликация
  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    if (seen.has(c.tag)) continue;
    seen.add(c.tag);
    unique.push(c);
    if (unique.length >= max) break;
  }

  const selected = unique.map(c => c.tag);

  for (const c of unique) {
    if (!c.always) used.tags.push(c.tag);
  }
  saveUsed(used);

  return selected;
}

/**
 * Сбрасывает историю ротации (можно вызвать вручную).
 */
export function resetRotation() {
  saveUsed({ date: '', tags: [] });
  console.log('✅ hashtags rotation reset');
}
