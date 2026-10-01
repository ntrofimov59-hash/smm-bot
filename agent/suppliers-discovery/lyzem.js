const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

function extractUsernames(html) {
  const seen = new Set();
  const out = [];
  const re = /t\.me\/([a-zA-Z][a-zA-Z0-9_]{3,31})/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const u = m[1];
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

export async function searchLyzem(query, { limit = 20 } = {}) {
  const results = new Map();
  for (const type of ['chats', 'channels']) {
    const url = `https://lyzem.com/search?q=${encodeURIComponent(query)}&type=${type}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru,en' } });
      if (!res.ok) continue;
      const html = await res.text();
      const usernames = extractUsernames(html);
      for (const u of usernames) {
        if (!results.has(u)) {
          results.set(u, { username: u, source: 'lyzem', query, sourceType: type });
        }
      }
    } catch { /* skip */ }
  }
  return Array.from(results.values()).slice(0, limit);
}
