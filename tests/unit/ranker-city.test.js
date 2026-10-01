import { describe, it, expect } from 'vitest';
import { rankCandidates, scoreCandidate } from '../../agent/outreach/ranker.js';

describe('outreach ranker city+direction', () => {
  it('drops other city when targetCity set', () => {
    const list = rankCandidates([
      { name: 'A', segment: 'venue', city: 'yerevan', phone: '1', status: 'found' },
      { name: 'B', segment: 'venue', city: 'bali', phone: '2', status: 'found' },
    ], { targetCity: 'yerevan' });
    expect(list.map((c) => c.name)).toEqual(['A']);
  });

  it('prefers verified venue in target city', () => {
    const a = scoreCandidate(
      { segment: 'venue', city: 'tbilisi', phone: '1', verified: true, meta: { rating: 4.8 } },
      { targetCity: 'tbilisi' },
    );
    const b = scoreCandidate(
      { segment: 'other', city: 'tbilisi', phone: '1' },
      { targetCity: 'tbilisi' },
    );
    expect(a.score).toBeGreaterThan(b.score);
  });
});
