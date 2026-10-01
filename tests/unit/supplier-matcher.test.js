import { describe, it, expect } from 'vitest';
import { scoreSupplier } from '../../agent/supplier-bot/matcher.js';

describe('supplier score', () => {
  it('verified same city beats unverified', () => {
    const a = scoreSupplier(
      { verified: true, city: 'yerevan', rating: 4.5, phone: '1' },
      { city: 'yerevan' },
    );
    const b = scoreSupplier(
      { verified: false, city: 'yerevan', rating: 5, phone: '1' },
      { city: 'yerevan' },
    );
    expect(a.score).toBeGreaterThan(b.score);
  });

  it('wrong city is penalized hard', () => {
    const a = scoreSupplier(
      { verified: true, city: 'bali', rating: 5 },
      { city: 'yerevan' },
    );
    expect(a.score).toBeLessThan(20);
  });
});
