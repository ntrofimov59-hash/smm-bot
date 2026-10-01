// agent/telegram-monitor/discovery/tgstat.js — поиск через TGStat API.
// Требует TGSTAT_API_TOKEN в .env. Получить: https://tgstat.ru/api
//
// Бесплатный тариф TGStat даёт ограниченное число запросов (обычно 100/мес),
// платный — больше. Если токена нет — модуль молча вернёт [] (не падаем).

const API = 'https://api.tgstat.ru';

export function hasTgstat() {
  return !!process.env.TGSTAT_API_TOKEN;
}

export async function searchTgstat(query, opts = {}) {
  const token = process.env.TGSTAT_API_TOKEN;
  if (!token) return [];

  const { limit = 30 } = opts;
  const url = `${API}/channels/search?token=${encodeURIComponent(token)}`
    + `&q=${encodeURIComponent(query)}`
    + `&limit=${Math.min(limit, 100)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`tgstat: HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== 'ok' || !data.response?.items) return [];

  return data.response.items.map(item => ({
    username: (item.username || '').replace(/^@/, ''),
    title: item.title || null,
    subscribers: item.participants_count || 0,
    description: item.description || null,
    source: 'tgstat',
    query,
    context: null,
    discoveredAt: new Date().toISOString(),
    status: 'pending',
  })).filter(x => x.username);
}
