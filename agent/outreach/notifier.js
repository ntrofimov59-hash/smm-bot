// agent/outreach/notifier.js — сводки и напоминания в Telegram.
// Использует ANALYTICS_BOT_TOKEN и ANALYTICS_CHAT_ID из .env (как telegram.js).

import { sendMessage } from '../telegram-api.js';

function fmtCandidate(c) {
  const parts = [`• <b>${c.name}</b>`, `(${c.segment}/${c.city || '—'})`];
  if (c.score != null) parts.push(`score=${c.score}`);
  if (c.phone) parts.push(`☎ ${c.phone}`);
  if (c.instagram) parts.push(`IG ${c.instagram}`);
  return parts.join(' ');
}

/**
 * Сводка новых кандидатов за сегодня + напоминания о follow-up.
 */
export async function notifyDailySummary({ projectSlug, newCount, pendingFollowups, topCandidates }) {
  const token = process.env.ANALYTICS_BOT_TOKEN;
  const chatId = process.env.ANALYTICS_CHAT_ID;
  if (!token || !chatId) return { ok: false, error: 'ANALYTICS_BOT_TOKEN/CHAT_ID не заданы' };

  const lines = [`🤝 [SMM/Outreach] ${projectSlug}`, ''];
  lines.push(`Новых за сегодня: <b>${newCount}</b>`);

  if (topCandidates?.length) {
    lines.push('');
    lines.push('<b>Топ-5 для ручной отправки:</b>');
    for (const c of topCandidates.slice(0, 5)) lines.push(fmtCandidate(c));
  }

  if (pendingFollowups?.length) {
    lines.push('');
    lines.push(`⏰ Follow-up: <b>${pendingFollowups.length}</b>`);
    for (const c of pendingFollowups.slice(0, 5)) {
      lines.push(`• ${c.name} — ${c.daysSinceContact} дн.`);
    }
  }

  lines.push('');
  lines.push('Отправка — вручную через outreach-cli show');

  try {
    await sendMessage(chatId, lines.join('\n'), { token });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
