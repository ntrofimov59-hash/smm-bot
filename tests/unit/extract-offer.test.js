import { describe, it, expect } from 'vitest';
import { extractSupplierOffer, looksLikeOffer } from '../../agent/suppliers/extract-offer.js';

describe('extractSupplierOffer', () => {
  it('detects photographer offer in yerevan', () => {
    const t = 'Я фотограф в Ереване, свадьбы и love story. Instagram @anna_photo +37499111222';
    expect(looksLikeOffer(t)).toBe(true);
    const o = extractSupplierOffer(t, { requireCity: true });
    expect(o.category).toBe('photographers');
    expect(o.city).toBe('yerevan');
    expect(o.instagram).toBe('anna_photo');
    expect(o.verified).toBe(false);
  });

  it('skips client request without offer', () => {
    const t = 'Ищу фотографа в Ереване на субботу';
    expect(extractSupplierOffer(t)).toBeNull();
  });

  it('requires city', () => {
    const t = 'Я диджей, пишите @djmax +37490000000';
    expect(extractSupplierOffer(t, { requireCity: true })).toBeNull();
    expect(extractSupplierOffer(t, { city: 'yerevan' }).category).toBe('djs');
  });
});
