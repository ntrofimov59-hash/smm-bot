// agent/sources/instagram-graph.js — fetching СВОИХ медиа через Instagram Graph API
//
// Используем официальный эндпоинт /me/media. Работает только для аккаунтов,
// которыми ты владеешь (или для бизнес-аккаунтов, к которым дан доступ).
// Никаких рисков бана — это официальный путь.
//
// Требует long-lived access token. Токен тот же, что для публикации.

const IG_GRAPH = 'https://graph.instagram.com/v21.0';

/**
 * Возвращает список медиа своих аккаунтов через Graph API.
 *
 * @param {Object} opts
 * @param {string} opts.accessToken — long-lived IG access token
 * @param {number} [opts.limit=25] — сколько последних постов запросить (макс 100)
 * @param {string[]} [opts.fields] — какие поля запрашивать
 * @param {Function} [opts.fetchImpl=fetch]
 * @returns {Promise<Array<{ id, mediaUrl, caption, permalink, timestamp, mediaType }>>}
 */
export async function fetchOwnMedia(opts) {
  const {
    accessToken,
    limit = 25,
    fields = ['id', 'caption', 'media_url', 'permalink', 'timestamp', 'media_type'],
    fetchImpl = fetch,
  } = opts;

  if (!accessToken) {
    throw new Error('instagram-graph: нужен accessToken');
  }
  if (limit < 1 || limit > 100) {
    throw new Error('instagram-graph: limit должен быть 1..100');
  }

  const params = new URLSearchParams({
    fields: fields.join(','),
    limit: String(limit),
    access_token: accessToken,
  });

  const url = `${IG_GRAPH}/me/media?${params.toString()}`;

  const res = await fetchImpl(url, {
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    let detail;
    try {
      const body = await res.json();
      detail = body?.error?.message || JSON.stringify(body);
    } catch {
      detail = `HTTP ${res.status}`;
    }
    throw new Error(`instagram-graph: ${detail}`);
  }

  const data = await res.json();
  const items = Array.isArray(data.data) ? data.data : [];

  return items
    .filter(m => m.media_url && (m.media_type === 'IMAGE' || m.media_type === 'CAROUSEL_ALBUM'))
    .map(m => ({
      id: m.id,
      mediaUrl: m.media_url,
      caption: m.caption || '',
      permalink: m.permalink || null,
      timestamp: m.timestamp || null,
      mediaType: m.media_type,
      source: 'instagram-graph',
    }));
}

/**
 * Получает медиа по конкретному IG user id (для бизнес-аккаунтов, к которым дан доступ).
 * Отличие от fetchOwnMedia: нужно знать igUserId.
 */
export async function fetchUserMedia({ igUserId, accessToken, limit = 25, fetchImpl = fetch }) {
  if (!igUserId) throw new Error('instagram-graph: нужен igUserId');
  if (!accessToken) throw new Error('instagram-graph: нужен accessToken');

  const params = new URLSearchParams({
    fields: 'id,caption,media_url,permalink,timestamp,media_type',
    limit: String(limit),
    access_token: accessToken,
  });

  const res = await fetchImpl(`${IG_GRAPH}/${igUserId}/media?${params.toString()}`, {
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    let detail;
    try {
      const body = await res.json();
      detail = body?.error?.message || JSON.stringify(body);
    } catch {
      detail = `HTTP ${res.status}`;
    }
    throw new Error(`instagram-graph: ${detail}`);
  }

  const data = await res.json();
  return (data.data || [])
    .filter(m => m.media_url && (m.media_type === 'IMAGE' || m.media_type === 'CAROUSEL_ALBUM'))
    .map(m => ({
      id: m.id,
      mediaUrl: m.media_url,
      caption: m.caption || '',
      permalink: m.permalink || null,
      timestamp: m.timestamp || null,
      mediaType: m.media_type,
      source: 'instagram-graph',
    }));
}
