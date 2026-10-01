// agent/suppliers/from-telegram.js — сохранить оффер из TG-лида в suppliers/
import * as store from './store.js';
import { extractSupplierOffer } from './extract-offer.js';

/**
 * @param {string} projectPath
 * @param {Object} lead — { text, city?, messageUrl?, channel?, match? }
 * @returns {{ ok, supplier?, reason? }}
 */
export function ingestLeadAsSupplier(projectPath, lead) {
  const city = lead.city || lead.match?.city || null;
  const offer = extractSupplierOffer(lead.text, {
    city,
    source: 'telegram',
    sourceUrl: lead.messageUrl || lead.sourceUrl || undefined,
    requireCity: true,
  });
  if (!offer) return { ok: false, reason: 'not_offer_or_no_city' };

  try {
    const s = store.addSupplier(projectPath, offer);
    return { ok: true, supplier: s };
  } catch (e) {
    if (/[Дд]убликат/.test(e.message)) return { ok: false, reason: 'duplicate', error: e.message };
    return { ok: false, reason: 'error', error: e.message };
  }
}

/**
 * Прогон списка лидов (из telegram-monitor store).
 */
export function ingestLeadsBatch(projectPath, leads) {
  let added = 0, dup = 0, skip = 0;
  for (const lead of leads) {
    const r = ingestLeadAsSupplier(projectPath, lead);
    if (r.ok) added++;
    else if (r.reason === 'duplicate') dup++;
    else skip++;
  }
  return { added, dup, skip, total: leads.length };
}
