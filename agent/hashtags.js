// agent/hashtags.js — подбирает хештеги из пула проекта + добавляет из vision
import fs from 'fs';
import path from 'path';

const DEFAULT_DATA_DIR = path.resolve(new URL('./data/', import.meta.url).pathname);

function getDataDir() {
  return process.env.SMM_DATA_DIR || DEFAULT_DATA_DIR;
}

function getUsedFile() {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'hashtags-used.json');
}

function loadUsed() {
  try {
    const file = getUsedFile();
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  return { date: '', tags: [] };
}

function saveUsed(data) {
  try {
    fs.writeFileSync(getUsedFile(), JSON.stringify(data, null, 2));
  } catch (e) { console.warn('hashtags: save failed:', e.message); }
}

function todayKey() { return new Date().toISOString().slice(0, 10); }

/**
 * Собирает финальный список хештегов с ротацией.
 */
export function buildHashtags(opts) {
  const {
    project,
    city = '',
    service = null,
    imageTags = [],
    llmHashtags = [],
    landmarkHashtag = null,
    max = 12,
  } = opts;

  const cfg = project.hashtags || {};
  const used = loadUsed();
  const today = todayKey();
  if (used.date !== today) { used.date = today; used.tags = []; }

  const usedSet = new Set(used.tags);
  const candidates = [];

  // 1. Всегда добавляем базовые
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

  // 3.5. Хештег локации (landmark) — ротация, приоритет выше LLM:
  // конкретное место важнее generic хештегов, но base всегда первые
  if (landmarkHashtag && !usedSet.has(landmarkHashtag)) {
    candidates.push({ tag: landmarkHashtag, priority: 2.5 });
  }

  // 4. Хештеги от LLM — ротация, приоритет выше среднего
  for (const t of llmHashtags) {
    if (!usedSet.has(t)) candidates.push({ tag: t, priority: 2 });
  }

  // 5. Vision-теги
  for (const tag of imageTags.slice(0, 5)) {
    const t = `#${tag.replace(/[^a-z0-9]/gi, '')}`;
    if (!usedSet.has(t) && !candidates.find(c => c.tag === t)) {
      candidates.push({ tag: t, priority: 0.5 });
    }
  }

  candidates.sort((a, b) => {
    if (a.always && !b.always) return -1;
    if (b.always && !a.always) return 1;
    return (b.priority || 0) - (a.priority || 0);
  });

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

export function resetRotation() {
  saveUsed({ date: '', tags: [] });
  console.log('✅ hashtags rotation reset');
}
