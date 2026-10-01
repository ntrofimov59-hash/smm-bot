// agent/accounts-resolver.js — токены Instagram только из accounts.json в момент публикации.
// В queue храним username + igUserId + city, без accessToken.

import path from 'path';
import { loadAccounts } from './config-loader.js';

/**
 * Находит аккаунт в accounts.json по username или igUserId.
 * @returns {{ username, igUserId, accessToken, city, active } | null}
 */
export function resolveInstagramAccount(projectPath, ref = {}) {
  if (!projectPath) return null;
  let accounts;
  try {
    accounts = loadAccounts(projectPath);
  } catch {
    return null;
  }
  if (!accounts?.instagram?.length) return null;

  const byUser = ref.username
    ? accounts.instagram.find((a) => a.username === ref.username)
    : null;
  const byId = ref.igUserId
    ? accounts.instagram.find((a) => String(a.igUserId) === String(ref.igUserId))
    : null;

  const acc = byUser || byId || null;
  if (!acc) return null;
  if (acc.active === false) return null;
  if (!acc.accessToken || !acc.igUserId) return null;

  return {
    username: acc.username,
    igUserId: acc.igUserId,
    accessToken: acc.accessToken,
    city: acc.city || ref.city || null,
    active: acc.active !== false,
  };
}

/**
 * Собирает safe-ссылку на аккаунт для очереди (без токена).
 */
export function toQueueAccountRef(acc) {
  return {
    username: acc.username,
    igUserId: acc.igUserId,
    city: acc.city || null,
    // accessToken намеренно НЕ кладём
  };
}

/**
 * Удаляет accessToken из объекта item (мутация копии для логов/миграции).
 */
export function stripTokensFromItem(item) {
  if (!item || !Array.isArray(item.accounts)) return item;
  return {
    ...item,
    accounts: item.accounts.map(({ _accessToken: _accessToken, ...rest }) => rest),
  };
}

/**
 * Резолвит полный account для publish из queue-item.
 */
export function resolveAccountForPublish(item, accRef) {
  const projectPath = item.projectPath
    || (item.projectSlug
      ? path.resolve(process.env.PROJECTS_ROOT || 'projects', item.projectSlug)
      : null);

  // 1) предпочтительно из файла
  const fromFile = resolveInstagramAccount(projectPath, accRef);
  if (fromFile) return fromFile;

  // 2) legacy fallback: токен ещё лежит в queue (старые записи)
  if (accRef?.accessToken && accRef?.igUserId) {
    console.warn(`⚠️  legacy token in queue for @${accRef.username} — мигрируй: node cli.js queue strip-tokens`);
    return {
      username: accRef.username,
      igUserId: accRef.igUserId,
      accessToken: accRef.accessToken,
      city: accRef.city || null,
      active: true,
    };
  }

  return null;
}
