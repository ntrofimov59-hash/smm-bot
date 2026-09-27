// agent/usage.js — дневные + месячные счётчики использования API
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(new URL('./data/', import.meta.url).pathname);
fs.mkdirSync(DATA_DIR, { recursive: true });

const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

// Дефолтные лимиты (можно переопределить в .env)
const LIMITS = {
  groq_tokens_day: Number(process.env.LIMIT_GROQ_TOKENS_DAY || 200000),
  groq_tokens_month: Number(process.env.LIMIT_GROQ_TOKENS_MONTH || 3000000),
  gemini_requests_day: Number(process.env.LIMIT_GEMINI_REQ_DAY || 1500),
  gemini_requests_month: Number(process.env.LIMIT_GEMINI_REQ_MONTH || 30000),
  posts_day: Number(process.env.LIMIT_POSTS_DAY || 20),
  posts_month: Number(process.env.LIMIT_POSTS_MONTH || 600),
};

function load() {
  try {
    if (fs.existsSync(USAGE_FILE)) {
      return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    }
  } catch (e) { console.warn('usage: load failed:', e.message); }
  return { days: {}, months: {} };
}

function save(data) {
  try {
    const tmp = USAGE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, USAGE_FILE);
  } catch (e) { console.error('usage: save failed:', e.message); }
}

function todayKey() { return new Date().toISOString().slice(0, 10); }
function monthKey() { return new Date().toISOString().slice(0, 7); }

function ensureDay(data, key) {
  if (!data.days[key]) {
    data.days[key] = { groq_tokens: 0, gemini_requests: 0, posts_published: 0, vision_cache_hits: 0 };
  }
  return data.days[key];
}

function ensureMonth(data, key) {
  if (!data.months[key]) {
    data.months[key] = { groq_tokens: 0, gemini_requests: 0, posts_published: 0 };
  }
  return data.months[key];
}

// === Публичные функции ===

export function trackGroq(tokens) {
  const d = load();
  const tk = todayKey(), mk = monthKey();
  ensureDay(d, tk).groq_tokens += tokens || 0;
  ensureMonth(d, mk).groq_tokens += tokens || 0;
  save(d);
}

export function trackGemini() {
  const d = load();
  const tk = todayKey(), mk = monthKey();
  ensureDay(d, tk).gemini_requests += 1;
  ensureMonth(d, mk).gemini_requests += 1;
  save(d);
}

export function trackCacheHit() {
  const d = load();
  ensureDay(d, todayKey()).vision_cache_hits += 1;
  save(d);
}

export function trackPost() {
  const d = load();
  const tk = todayKey(), mk = monthKey();
  ensureDay(d, tk).posts_published += 1;
  ensureMonth(d, mk).posts_published += 1;
  save(d);
}

export function getStatus() {
  const d = load();
  const tk = todayKey(), mk = monthKey();
  const today = ensureDay(d, tk);
  const month = ensureMonth(d, mk);

  const pct = (used, limit) => limit > 0 ? Math.round((used / limit) * 100) : 0;

  return {
    today: {
      date: tk,
      groq_tokens: today.groq_tokens,
      groq_tokens_pct: pct(today.groq_tokens, LIMITS.groq_tokens_day),
      gemini_requests: today.gemini_requests,
      gemini_requests_pct: pct(today.gemini_requests, LIMITS.gemini_requests_day),
      posts: today.posts_published,
      posts_pct: pct(today.posts_published, LIMITS.posts_day),
      cache_hits: today.vision_cache_hits,
    },
    month: {
      key: mk,
      groq_tokens: month.groq_tokens,
      groq_tokens_pct: pct(month.groq_tokens, LIMITS.groq_tokens_month),
      gemini_requests: month.gemini_requests,
      gemini_requests_pct: pct(month.gemini_requests, LIMITS.gemini_requests_month),
      posts: month.posts_published,
      posts_pct: pct(month.posts_published, LIMITS.posts_month),
    },
    limits: LIMITS,
  };
}

// Проверка, разрешена ли операция с учётом лимитов
export function canPublishPost() {
  const s = getStatus();
  if (s.today.posts >= LIMITS.posts_day) return { ok: false, reason: 'posts_day_limit' };
  if (s.month.posts >= LIMITS.posts_month) return { ok: false, reason: 'posts_month_limit' };
  return { ok: true };
}

export function canCallGroq(estimatedTokens = 2000) {
  const s = getStatus();
  if (s.today.groq_tokens + estimatedTokens > LIMITS.groq_tokens_day) return { ok: false, reason: 'groq_day_limit' };
  if (s.month.groq_tokens + estimatedTokens > LIMITS.groq_tokens_month) return { ok: false, reason: 'groq_month_limit' };
  return { ok: true };
}

export function canCallGemini() {
  const s = getStatus();
  if (s.today.gemini_requests >= LIMITS.gemini_requests_day) return { ok: false, reason: 'gemini_day_limit' };
  if (s.month.gemini_requests >= LIMITS.gemini_requests_month) return { ok: false, reason: 'gemini_month_limit' };
  return { ok: true };
}
