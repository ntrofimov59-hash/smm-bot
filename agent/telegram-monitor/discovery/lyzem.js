// agent/telegram-monitor/discovery/lyzem.js — поиск через Lyzem.
// Отсеиваем мусор: внутренние ссылки Lyzem, тестовые каналы, боты.

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Мусорные username'ы — внутренние ссылки Lyzem и очевидный служебный шум
const BLACKLIST_USERNAMES = new Set([
  'lyzemcom', 'lyzem', 'lyzembot', 'mlyzembot',
  'editorpost_bot', 'editorpost', 'telegram', 'telegramtips',
  'test', 'testbot', 'testchannel',
]);

const BLACKLIST_PATTERNS = [
  /^test/i,
  /^testchannel_/i,
  /lyzem/i,
  /editorpost/i,
  /telegram$/i,
  /^channel_/i,
];

function isBlacklisted(username) {
  const u = username.toLowerCase();
  if (BLACKLIST_USERNAMES.has(u)) return true;
  return BLACKLIST_PATTERNS.some(re => re.test(u));
}

function isLikelyBot(username) {
  return /bot$/i.test(username);
}

function extractUsernames(html) {
  const found = new Map();

  const re1 = /t\.me\/([a-zA-Z][a-zA-Z0-9_]{3,31})/g;
  let m;
  while ((m = re1.exec(html)) !== null) {
    const u = m[1];
    if (!found.has(u)) found.set(u, { username: u, context: '' });
  }

  const re2 = /tg:\/\/resolve\?domain=([a-zA-Z][a-zA-Z0-9_]{3,31})/g;
  while ((m = re2.exec(html)) !== null) {
    const u = m[1];
    if (!found.has(u)) found.set(u, { username: u, context: '' });
  }

  // Контекст
  for (const [u, obj] of found.entries()) {
    const idx = html.indexOf(u);
    if (idx >= 0) {
      const start = Math.max(0, idx - 300);
      const end = Math.min(html.length, idx + u.length + 300);
      let ctx = html.slice(start, end);
      ctx = ctx.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      obj.context = ctx;
    }
  }

  return Array.from(found.values());
}

/**
 * Дополнительный фильтр: если из контекста видно, что это бот/сервис — отбрасываем.
 */
function looksLikeJunk(entry) {
  const ctx = entry.context.toLowerCase();
  if (ctx.includes('lyzem')) return true;
  if (ctx.includes('editor post')) return true;
  // слишком мало контекста — вероятно, ссылка внутри JS-скрипта страницы
  if (entry.context.length < 20) return true;
  return false;
}

export async function searchLyzem(query, opts = {}) {
  const { limit = 30 } = opts;
  if (!query) throw new Error('lyzem: пустой query');

  // Пробуем разные типы поиска: chats (группы) и channels
  const allResults = new Map();

  for (const type of ['chats', 'channels']) {
    const url = `https://lyzem.com/search?q=${encodeURIComponent(query)}&type=${type}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru,en' } });
      if (!res.ok) continue;
      const html = await res.text();
      const items = extractUsernames(html);

      for (const it of items) {
        if (isBlacklisted(it.username)) continue;
        if (isLikelyBot(it.username)) continue;
        if (looksLikeJunk(it)) continue;
        if (!allResults.has(it.username)) {
          allResults.set(it.username, { ...it, sourceType: type });
        }
      }
    } catch { /* ignore */ }
  }

  return Array.from(allResults.values()).slice(0, limit).map(it => ({
    username: it.username,
    source: 'lyzem',
    sourceType: it.sourceType,
    query,
    context: it.context.slice(0, 400),
    discoveredAt: new Date().toISOString(),
    status: 'pending',
  }));
}
