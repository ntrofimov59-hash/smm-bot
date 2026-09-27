import { describe, it, expect } from 'vitest';
import { matchAccountsByTags, pickBestMatches } from '../../agent/matcher.js';

const accounts = [
  { username: 'phuket',  active: true,  cityTags: ['beach', 'ocean', 'sunset', 'tropical'] },
  { username: 'marrakech', active: true, cityTags: ['desert', 'city', 'architecture'] },
  { username: 'nanchang', active: true, cityTags: ['city', 'china', 'culture'] },
  { username: 'yerevan', active: true,  cityTags: ['city', 'culture', 'mountains'] },
  { username: 'no-tags', active: true,  cityTags: [] },
  { username: 'inactive', active: false, cityTags: ['beach', 'ocean'] },
];

describe('matcher.matchAccountsByTags', () => {
  it('возвращает [] для пустых tags', () => {
    expect(matchAccountsByTags([], accounts)).toEqual([]);
    expect(matchAccountsByTags(null, accounts)).toEqual([]);
    expect(matchAccountsByTags(undefined, accounts)).toEqual([]);
  });

  it('возвращает [] для пустых accounts', () => {
    expect(matchAccountsByTags(['beach'], [])).toEqual([]);
    expect(matchAccountsByTags(['beach'], null)).toEqual([]);
  });

  it('игнорирует неактивные аккаунты', () => {
    const r = matchAccountsByTags(['beach'], accounts);
    expect(r.find(a => a.username === 'inactive')).toBeUndefined();
  });

  it('находит аккаунт с совпадением тегов', () => {
    const r = matchAccountsByTags(['beach', 'ocean'], accounts);
    expect(r[0].username).toBe('phuket');
    expect(r[0]._matchedTags).toContain('beach');
  });

  it('сортирует по score (лучшее совпадение первым)', () => {
    const r = matchAccountsByTags(['city', 'culture'], accounts);
    // nanchang: 2/3, yerevan: 2/3, marrakech: 1/3
    expect(r[0]._score).toBeGreaterThanOrEqual(r[r.length - 1]._score);
  });

  it('нечёткое совпадение по регистру', () => {
    const r = matchAccountsByTags(['BEACH', 'Ocean'], accounts);
    expect(r.some(a => a.username === 'phuket')).toBe(true);
  });

  it('аккаунт без cityTags получает минимальный score 0.1', () => {
    const r = matchAccountsByTags(['beach'], accounts);
    const noTags = r.find(a => a.username === 'no-tags');
    expect(noTags).toBeDefined();
    expect(noTags._score).toBe(0.1);
  });

  it('аккаунт без совпадений не попадает в результат', () => {
    const r = matchAccountsByTags(['beach'], accounts);
    expect(r.find(a => a.username === 'marrakech')).toBeUndefined();
  });

  it('обогащает результат _score и _matchedTags', () => {
    const r = matchAccountsByTags(['city'], accounts);
    expect(r[0]).toHaveProperty('_score');
    expect(r[0]).toHaveProperty('_matchedTags');
  });
});

describe('matcher.pickBestMatches', () => {
  it('возвращает только совпадения выше minScore', () => {
    const r = pickBestMatches(['beach', 'ocean', 'sunset'], accounts, { minScore: 0.5 });
    expect(r.find(a => a.username === 'no-tags')).toBeUndefined();
  });

  it('фолбэк на top-1 если никто не прошёл порог', () => {
    // очень высокий порог — никто не пройдёт
    const r = pickBestMatches(['beach'], accounts, { minScore: 5 });
    expect(r).toHaveLength(1);
    expect(r[0].username).toBe('phuket'); // у него самый высокий score
  });

  it('соблюдает maxResults', () => {
    const r = pickBestMatches(['city', 'culture'], accounts, { minScore: 0.1, maxResults: 2 });
    expect(r.length).toBeLessThanOrEqual(2);
  });

  it('возвращает [] если accounts пустой', () => {
    expect(pickBestMatches(['beach'], [], {})).toEqual([]);
  });
});
