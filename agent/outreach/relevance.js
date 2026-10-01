// agent/outreach/relevance.js — отсев мусора под Coucou (events / wedding / banquet)
// Не ходит в сеть. Только name + notes + meta.types + segment.

const REJECT_RE = [
  /\bpizza\b/i, /пицц/i, /պիցցա/i,
  /\bsushi\b/i, /суши/i, /սուշի/i,
  /\bspa\b/i, /спа\s*центр/i, /салон\s*красот/i,
  /детск/i, /kids?\b/i, /game\s*show/i, /развлекательн(ый|ый)\s*центр/i,
  /\bcafé\b/i, /\bcafe\b/i, /кофейн/i,
  /аптек/i, /pharmacy/i, /clinic/i, /стомат/i,
  /автомойк/i, /car\s*wash/i, /шиномонтаж/i,
  /школа\s*танц/i, /fitness/i, /тренажёр/i,
];

// чистый туризм без event-слов
const TRAVEL_ONLY_RE = [
  /\btravel\b/i, /\btour\b/i, /турист/i, /տուր/i, /թրավլ/i, /travel\s*agency/i,
  /авиа/i, /avia\b/i, /airline/i, /booking\b/i,
];

const EVENT_HINT_RE = [
  /wedding/i, /свадьб/i, /հարսանիք/i,
  /banquet/i, /банкет/i, /տոնակատար/i,
  /event/i, /мероприят/i, /համերգ/i,
  /hall\b/i, /зал/i, /սրահ/i,
  /venue/i, /площадк/i,
  /planner/i, /организац/i, /organizer/i,
  /корпоратив/i, /corporate/i,
  /hotel/i, /отел/i, /հյուրանոց/i,
  /resort/i, /villa\s*wedding/i,
  /ресторанн(ый|ый)\s*комплекс/i,
  /зал\s*торжеств/i, /торжеств/i,
  /noor\s*wedding/i, /pulse\s*events/i, /tovmasyan\s*events/i,
];

const AGENCY_EVENT_RE = [
  /event/i, /wedding/i, /мероприят/i, /организац/i, /production/i,
  /planner/i, /banquet/i, /корпоратив/i,
];

function blob(c) {
  const types = Array.isArray(c.meta?.types) ? c.meta.types.join(' ') : '';
  return [c.name, c.notes, c.address, types, c.segment].filter(Boolean).join(' ');
}

/**
 * @returns {{ ok: boolean, reason?: string, boost: number }}
 * boost: -30..+25 к ranker
 */
export function assessRelevance(c) {
  const text = blob(c);
  if (!text.trim()) return { ok: true, boost: 0, reason: 'empty' };

  for (const re of REJECT_RE) {
    if (re.test(text)) return { ok: false, boost: -40, reason: `reject:${re.source}` };
  }

  const hasEvent = EVENT_HINT_RE.some((re) => re.test(text));
  const travelOnly = TRAVEL_ONLY_RE.some((re) => re.test(text));

  // agency/travel без event-сигналов — не наш B2B
  if ((c.segment === 'agency' || travelOnly) && !hasEvent && !AGENCY_EVENT_RE.some((re) => re.test(text))) {
    if (travelOnly || c.segment === 'agency') {
      return { ok: false, boost: -25, reason: 'travel_or_agency_without_events' };
    }
  }

  let boost = 0;
  if (hasEvent) boost += 18;
  if (/wedding|свадьб|հարսանիք/i.test(text)) boost += 8;
  if (/banquet|банкет|зал\s*торжеств/i.test(text)) boost += 6;
  if (/hotel|отел|հյուրանոց|marriott|hilton|hyatt/i.test(text)) boost += 5;

  // голая «пицца» уже в REJECT; мелкие рестораны без event-hint — слабый минус
  if (c.segment === 'venue' && !hasEvent && /ресторан|restaurant/i.test(text)) {
    boost -= 8;
  }

  return { ok: true, boost: Math.max(-30, Math.min(25, boost)), reason: hasEvent ? 'event_hint' : 'neutral' };
}

export function isRelevantClient(c) {
  return assessRelevance(c).ok;
}
