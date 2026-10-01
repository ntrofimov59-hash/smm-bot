// agent/telegram-monitor/checker.js — проверка кандидатов через userbot.
// Только чтение.

import { Api } from 'telegram';

/**
 * Достаёт число подписчиков через разные способы.
 */
async function getParticipants(client, entity) {
  // 1. Прямое поле (для megagroup/channel часто уже есть)
  if (typeof entity.participantsCount === 'number' && entity.participantsCount > 0) {
    return entity.participantsCount;
  }

  // 2. channels.GetFullChannel (для каналов и мегагрупп)
  if (entity.broadcast || entity.megagroup || entity.className === 'Channel') {
    try {
      const full = await client.invoke(
        new Api.channels.GetFullChannel({ channel: entity })
      );
      const n = full.fullChat?.participantsCount;
      if (typeof n === 'number') return n;
    } catch (e) {
      // иногда нужно как InputChannel
      try {
        const inputCh = new Api.InputChannel({
          channelId: entity.id,
          accessHash: entity.accessHash,
        });
        const full = await client.invoke(
          new Api.channels.GetFullChannel({ channel: inputCh })
        );
        const n = full.fullChat?.participantsCount;
        if (typeof n === 'number') return n;
      } catch { /* ignore */ }
    }
  }

  // 3. Обычные группы
  try {
    const full = await client.invoke(
      new Api.messages.GetFullChat({ chatId: entity.id })
    );
    const n = full.fullChat?.participantsCount;
    if (typeof n === 'number') return n;
  } catch { /* ignore */ }

  // 4. Fallback: попробовать getParticipants с малой пачкой
  try {
    const participants = await client.getParticipants(entity, { limit: 200 });
    if (Array.isArray(participants)) {
      // вернёт max 200; если ровно 200, скорее всего больше
      return participants.length === 200 ? '200+' : participants.length;
    }
  } catch { /* ignore */ }

  return null;
}

function detectType(entity) {
  if (entity.bot) return 'bot';
  if (entity.broadcast) return 'channel';
  if (entity.megagroup) return 'megagroup';
  if (entity.className === 'Chat' || entity.className === 'ChatForbidden') return 'chat';
  if (entity.className === 'User') return 'user';
  return 'unknown';
}

export async function checkOne(client, usernameRaw) {
  const username = String(usernameRaw).replace(/^@/, '');
  try {
    const entity = await client.getEntity('@' + username);

    const type = detectType(entity);
    if (type === 'bot') return { ok: false, error: 'bot (не канал/группа)' };
    if (entity.scam) return { ok: false, error: 'scam-помечен' };
    if (entity.fake) return { ok: false, error: 'fake-помечен' };

    const subscribers = await getParticipants(client, entity);
    const about = entity.about || null;

    return {
      ok: true,
      title: entity.title || username,
      subscribers,
      type,
      about,
      verified: !!entity.verified,
      username,
    };
  } catch (e) {
    return { ok: false, error: e.message || 'unknown error' };
  }
}
