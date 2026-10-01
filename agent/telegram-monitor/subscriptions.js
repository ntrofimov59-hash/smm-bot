// agent/telegram-monitor/subscriptions.js — что уже подписано у userbot.
// Использует client.getDialogs() для получения списка чатов.

/**
 * Возвращает Set из username (lowercase), на которые подписан userbot.
 */
export async function getSubscribedUsernames(client) {
  const set = new Set();
  try {
    const dialogs = await client.getDialogs({ limit: 500 });
    for (const d of dialogs) {
      const u = d.entity?.username;
      if (u) set.add(String(u).toLowerCase());
      // также добавим id
      if (d.entity?.id) set.add(String(d.entity.id));
    }
  } catch (e) {
    console.error('subscriptions: ошибка получения диалогов:', e.message);
  }
  return set;
}

/**
 * Фильтрует список кандидатов, исключая тех, на кого уже подписан.
 */
export function filterNew(candidates, subscribedSet) {
  return candidates.filter(c => {
    const u = String(c.username || '').toLowerCase();
    return !subscribedSet.has(u);
  });
}
