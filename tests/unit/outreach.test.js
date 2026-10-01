// tests/unit/outreach.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import * as store from '../../agent/outreach/store.js';
import * as ranker from '../../agent/outreach/ranker.js';
import * as links from '../../agent/outreach/links.js';
import * as reminders from '../../agent/outreach/reminders.js';

let PROJECT;

beforeEach(() => {
  PROJECT = path.join(os.tmpdir(), 'vitest-outreach-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
  fs.mkdirSync(path.join(PROJECT, 'outreach'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(PROJECT, { recursive: true, force: true });
});

describe('outreach.store', () => {
  it('добавляет кандидата и читает его', () => {
    const c = store.addCandidate(PROJECT, { name: 'Villa Rosa', segment: 'venue', city: 'yerevan', phone: '+374 10 555 121' });
    expect(c.id).toBeTruthy();
    expect(c.status).toBe('found');
    expect(store.getCandidate(PROJECT, c.id).name).toBe('Villa Rosa');
  });

  it('отлавливает дубликат по телефону', () => {
    store.addCandidate(PROJECT, { name: 'A', segment: 'venue', city: 'yerevan', phone: '+374 10 555 121' });
    expect(() => store.addCandidate(PROJECT, { name: 'B', segment: 'venue', city: 'other', phone: '37410555121' })).toThrow(/дубликат/);
  });

  it('отлавливает дубликат по name+city', () => {
    store.addCandidate(PROJECT, { name: 'Villa Rosa', segment: 'venue', city: 'yerevan' });
    expect(() => store.addCandidate(PROJECT, { name: 'villa rosa', segment: 'venue', city: 'Yerevan' })).toThrow(/дубликат/);
  });

  it('отвергает неизвестный segment', () => {
    expect(() => store.addCandidate(PROJECT, { name: 'X', segment: 'nonsense' })).toThrow();
  });

  it('обновляет статус и ведёт историю', () => {
    const c = store.addCandidate(PROJECT, { name: 'X', segment: 'venue' });
    store.updateCandidate(PROJECT, c.id, { status: 'drafted' });
    store.updateCandidate(PROJECT, c.id, { status: 'sent' });
    const after = store.getCandidate(PROJECT, c.id);
    expect(after.status).toBe('sent');
    expect(after.history.length).toBe(2);
    expect(after.lastContactAt).toBeTruthy();
  });
});

describe('outreach.ranker', () => {
  it('venue в домашнем городе с каналами — высокий балл', () => {
    const r = ranker.scoreCandidate({
      name: 'Villa Rosa', segment: 'venue', city: 'yerevan',
      phone: '+374...', instagram: '@x', website: 'x.com',
      meta: { rating: 4.8, userRatingCount: 120, types: ['event_venue'] },
    });
    expect(r.score).toBeGreaterThanOrEqual(90);
  });

  it('другой город — ниже', () => {
    const a = ranker.scoreCandidate({ name: 'A', segment: 'venue', city: 'yerevan', phone: '+374' });
    const b = ranker.scoreCandidate({ name: 'B', segment: 'venue', city: 'unknown', phone: '+374' });
    expect(a.score).toBeGreaterThan(b.score);
  });

  it('do_not_contact — 0', () => {
    const r = ranker.scoreCandidate({ name: 'X', segment: 'venue', city: 'yerevan', status: 'do_not_contact' });
    expect(r.score).toBe(0);
  });

  it('rankCandidates сортирует по убыванию', () => {
    const list = [
      { id: 'a', name: 'Low', segment: 'other' },
      { id: 'b', name: 'High', segment: 'venue', city: 'yerevan', phone: '+374', instagram: '@x' },
    ];
    const ranked = ranker.rankCandidates(list);
    expect(ranked[0].name).toBe('High');
  });
});

describe('outreach.links', () => {
  it('строит wa.me с текстом', () => {
    const l = links.buildLinks({ phone: '+374 10 555 121' }, 'Привет');
    expect(l.whatsapp).toMatch(/^https:\/\/wa\.me\/37410555121\?text=/);
  });

  it('нормализует instagram', () => {
    expect(links.buildLinks({ instagram: '@villarosa_am' }).instagram).toBe('https://instagram.com/villarosa_am');
    expect(links.buildLinks({ instagram: 'https://instagram.com/villarosa_am/' }).instagram).toBe('https://instagram.com/villarosa_am');
  });

  it('нормализует telegram', () => {
    expect(links.buildLinks({ telegram: '@villarosa' }).telegram).toBe('https://t.me/villarosa');
    expect(links.buildLinks({ telegram: 'https://t.me/villarosa' }).telegram).toBe('https://t.me/villarosa');
  });

  it('без телефона whatsapp не строится', () => {
    expect(links.buildLinks({ instagram: '@x' }).whatsapp).toBeUndefined();
  });
});

describe('outreach.reminders', () => {
  it('followup через 3+ дня', () => {
    const now = new Date();
    const inDays = (n) => new Date(now.getTime() - n * 86400000).toISOString();
    const list = [
      { name: 'Old', status: 'sent', lastContactAt: inDays(4), followupCount: 0 },
      { name: 'Fresh', status: 'sent', lastContactAt: inDays(1), followupCount: 0 },
      { name: 'Already', status: 'sent', lastContactAt: inDays(5), followupCount: 2 },
    ];
    const pending = reminders.getPendingFollowups(list, now);
    expect(pending.map(c => c.name)).toEqual(['Old']);
  });
});
