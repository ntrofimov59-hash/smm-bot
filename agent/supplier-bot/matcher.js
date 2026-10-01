import * as store from '../suppliers/store.js';

/**
 * Ищет поставщиков по разобранному запросу.
 */
export function matchSuppliers(projectPath, query, { limit = 5, requireVerified = false } = {}) {
  if (!query.category) {
    return { ok: false, reason: 'no_category', list: [] };
  }

  let list = store.listAll(projectPath, {
    category: query.category,
    city: query.city || null,
    onlyVerified: requireVerified,
  });

  let usedFallback = false;

  // Если с городом пусто — пробуем без города
  if (!list.length && query.city) {
    list = store.listAll(projectPath, {
      category: query.category,
      onlyVerified: requireVerified,
    });
    usedFallback = true;
  }

  // Сортировка: verified, потом rating, потом projectsCount
  list.sort((a, b) => {
    if (a.verified !== b.verified) return b.verified ? 1 : -1;
    const ra = a.rating || 0, rb = b.rating || 0;
    if (ra !== rb) return rb - ra;
    return (b.projectsCount || 0) - (a.projectsCount || 0);
  });

  return {
    ok: true,
    list: list.slice(0, limit),
    total: list.length,
    usedFallback,
  };
}
