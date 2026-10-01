import { describe, it, expect } from 'vitest';
import { assessRelevance } from '../../agent/outreach/relevance.js';

describe('assessRelevance', () => {
  it('rejects pizza', () => {
    expect(assessRelevance({ name: 'Tashir Pizza', segment: 'venue', city: 'yerevan' }).ok).toBe(false);
  });
  it('rejects pure travel agency', () => {
    expect(assessRelevance({ name: 'Hayreniq tour', segment: 'agency', city: 'yerevan' }).ok).toBe(false);
  });
  it('keeps wedding events', () => {
    const r = assessRelevance({ name: 'Noor wedding', segment: 'agency', city: 'yerevan' });
    expect(r.ok).toBe(true);
    expect(r.boost).toBeGreaterThan(0);
  });
  it('keeps banquet hall', () => {
    expect(assessRelevance({ name: 'Rubina hall (зал торжеств)', segment: 'venue' }).ok).toBe(true);
  });
});
