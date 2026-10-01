// agent/outreach/reminders.js — кому и когда напомнить про follow-up.
// Правила: 1 follow-up через 3-5 дней после отправки. Больше не долбим.

const FOLLOWUP_MIN_DAYS = 3;
const FOLLOWUP_MAX_DAYS = 5;

function daysBetween(aIso, bIso) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/**
 * Возвращает список кандидатов, которым нужен follow-up.
 */
export function getPendingFollowups(candidates, now = new Date()) {
  const nowIso = now.toISOString();
  const result = [];

  for (const c of candidates) {
    if (c.status !== 'sent') continue;
    if (!c.lastContactAt) continue;
    if ((c.followupCount || 0) >= 2) continue;

    const days = daysBetween(c.lastContactAt, nowIso);
    if (days >= FOLLOWUP_MIN_DAYS && days <= FOLLOWUP_MAX_DAYS + 10) {
      result.push({ ...c, daysSinceContact: days });
    }
  }

  return result.sort((a, b) => b.daysSinceContact - a.daysSinceContact);
}

/**
 * Возвращает «зависших»: drafter > 3 дней, status sent, но так и не получивших follow-up.
 */
export function getStuckCandidates(candidates, now = new Date()) {
  const nowIso = now.toISOString();
  return candidates.filter(c => {
    if (c.status === 'drafted') {
      const days = daysBetween(c.createdAt, nowIso);
      return days >= 7; // черновик не одобрили за неделю
    }
    return false;
  });
}

export { FOLLOWUP_MIN_DAYS, FOLLOWUP_MAX_DAYS };
