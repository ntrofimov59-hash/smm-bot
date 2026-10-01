export { searchLyzem } from './lyzem.js';
export { searchTgstat, hasTgstat } from './tgstat.js';

import { searchLyzem } from './lyzem.js';
import { searchTgstat, hasTgstat } from './tgstat.js';

/**
 * Объединённый поиск: Lyzem + TGStat (если есть токен).
 * Дедуп по username.
 */
export async function discover(query, opts = {}) {
  const results = new Map();

  try {
    const lyzem = await searchLyzem(query, opts);
    for (const r of lyzem) if (!results.has(r.username)) results.set(r.username, r);
  } catch (e) {
    console.error(`⚠️  lyzem: ${e.message}`);
  }

  if (hasTgstat()) {
    try {
      const tg = await searchTgstat(query, opts);
      for (const r of tg) {
        if (!results.has(r.username)) results.set(r.username, r);
      }
    } catch (e) {
      console.error(`⚠️  tgstat: ${e.message}`);
    }
  }

  return Array.from(results.values());
}
