import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir;
let loc;

const project = {
  cities: {
    phuket: {
      displayName: 'Phuket',
      country: 'Thailand',
      tags: ['beach', 'tropical', 'sunset'],
      hashtags: ['#phuket', '#thailand'],
      landmarks: [
        { name: 'Patong Beach', hashtag: '#patongbeach', type: 'beach' },
        { name: 'Kata Beach',   hashtag: '#katabeach',   type: 'beach' },
        { name: 'Old Town',     hashtag: '#phuketoldtown','type': 'culture' },
      ],
      nearby: ['Phi Phi', 'Krabi'],
      searchQueries: ['phuket beach', 'phuket sunset'],
    },
    empty: { displayName: 'Empty' },
  },
  hashtags: {
    cities: {
      legacy: ['#legacy1', '#legacy2'],
    },
  },
};

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loc-'));
  vi.stubEnv('SMM_DATA_DIR', tmpDir);
  vi.resetModules();
  loc = await import('../../agent/locations.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('locations.getCity / listCities', () => {
  it('returns city object', () => {
    expect(loc.getCity(project, 'phuket').displayName).toBe('Phuket');
  });
  it('returns null for unknown', () => {
    expect(loc.getCity(project, 'nowhere')).toBeNull();
    expect(loc.getCity(null, 'phuket')).toBeNull();
    expect(loc.getCity(project, null)).toBeNull();
  });
  it('listCities returns keys', () => {
    expect(loc.listCities(project)).toEqual(['phuket', 'empty']);
  });
  it('listCities on missing cities → []', () => {
    expect(loc.listCities({})).toEqual([]);
  });
});

describe('locations.getCityTags', () => {
  it('returns tags array', () => {
    expect(loc.getCityTags(project, 'phuket')).toContain('beach');
  });
  it('empty array for city without tags', () => {
    expect(loc.getCityTags(project, 'empty')).toEqual([]);
  });
  it('empty for unknown city', () => {
    expect(loc.getCityTags(project, 'nowhere')).toEqual([]);
  });
});

describe('locations.getCityHashtags', () => {
  it('prefers new cities.hashtags', () => {
    expect(loc.getCityHashtags(project, 'phuket')).toEqual(['#phuket', '#thailand']);
  });
  it('falls back to hashtags.cities legacy', () => {
    const legacyProject = { hashtags: { cities: { legacy: ['#a', '#b'] } } };
    expect(loc.getCityHashtags(legacyProject, 'legacy')).toEqual(['#a', '#b']);
  });
  it('empty for unknown', () => {
    expect(loc.getCityHashtags(project, 'nowhere')).toEqual([]);
  });
});

describe('locations.pickLandmark', () => {
  it('returns a landmark', () => {
    const l = loc.pickLandmark(project, 'phuket');
    expect(l).not.toBeNull();
    expect(l.name).toBeTruthy();
    expect(l.hashtag).toMatch(/^#/);
  });
  it('filters by type', () => {
    const l = loc.pickLandmark(project, 'phuket', { type: 'culture' });
    expect(l.name).toBe('Old Town');
  });
  it('fallback to any when type not found', () => {
    const l = loc.pickLandmark(project, 'phuket', { type: 'unicorn' });
    expect(l).not.toBeNull();
  });
  it('respects exclude', () => {
    const l = loc.pickLandmark(project, 'phuket', { exclude: ['Patong Beach', 'Kata Beach'] });
    expect(l.name).toBe('Old Town');
  });
  it('returns null for city without landmarks', () => {
    expect(loc.pickLandmark(project, 'empty')).toBeNull();
  });
  it('rotates through landmarks', () => {
    const first = loc.pickLandmark(project, 'phuket', { type: 'beach' }).name;
    const second = loc.pickLandmark(project, 'phuket', { type: 'beach' }).name;
    expect(first).not.toBe(second);
    const third = loc.pickLandmark(project, 'phuket', { type: 'beach' }).name;
    expect(third).toBe(first); // wrap around
  });
  it('rotation is per city+type', () => {
    const a = loc.pickLandmark(project, 'phuket', { type: 'beach' }).name;
    const b = loc.pickLandmark(project, 'phuket', { type: 'culture' }).name;
    expect(a).not.toBe(b);
  });
});

describe('locations.buildCaptionContext', () => {
  it('builds context with landmark', () => {
    const s = loc.buildCaptionContext(project, 'phuket', { landmark: { name: 'Patong Beach' } });
    expect(s).toContain('Patong Beach');
    expect(s).toContain('Phuket');
    expect(s).toContain('Thailand');
    expect(s).toContain('Phi Phi');
  });
  it('without landmark uses city name', () => {
    const s = loc.buildCaptionContext(project, 'phuket');
    expect(s).toContain('Phuket, Thailand');
    expect(s).not.toContain('Patong');
  });
  it('empty string for unknown city', () => {
    expect(loc.buildCaptionContext(project, 'nowhere')).toBe('');
  });
});

describe('locations.buildSearchQueries', () => {
  it('returns explicit searchQueries', () => {
    expect(loc.buildSearchQueries(project, 'phuket')).toEqual(['phuket beach', 'phuket sunset']);
  });
  it('falls back to displayName + tags', () => {
    const p = {
      cities: { x: { displayName: 'City X', tags: ['beach', 'city'] } },
    };
    expect(loc.buildSearchQueries(p, 'x')).toEqual(['City X beach', 'City X city']);
  });
  it('respects limit', () => {
    const p = {
      cities: { x: { displayName: 'X', tags: ['a', 'b', 'c', 'd', 'e'] } },
    };
    expect(loc.buildSearchQueries(p, 'x', { limit: 2 })).toHaveLength(2);
  });
  it('empty for unknown city', () => {
    expect(loc.buildSearchQueries(project, 'nope')).toEqual([]);
  });
});

describe('locations.resetRotation', () => {
  it('resets rotation state', () => {
    const first = loc.pickLandmark(project, 'phuket', { type: 'beach' }).name;
    loc.pickLandmark(project, 'phuket', { type: 'beach' });
    loc.resetRotation();
    const after = loc.pickLandmark(project, 'phuket', { type: 'beach' }).name;
    expect(after).toBe(first);
  });
});

describe('locations.pickLandmarkForVision', () => {
  it('picks landmark matching vision tag type', () => {
    const l = loc.pickLandmarkForVision(project, 'phuket', ['beach', 'sunset']);
    expect(l.type).toBe('beach');
  });

  it('picks culture landmark when vision says culture', () => {
    const l = loc.pickLandmarkForVision(project, 'phuket', ['culture']);
    expect(l.name).toBe('Old Town');
  });

  it('falls back to any landmark when no type matches', () => {
    const l = loc.pickLandmarkForVision(project, 'phuket', ['unicorn', 'rainbow']);
    expect(l).not.toBeNull();
  });

  it('returns null for city without landmarks', () => {
    expect(loc.pickLandmarkForVision(project, 'empty', ['beach'])).toBeNull();
  });

  it('returns null for unknown city', () => {
    expect(loc.pickLandmarkForVision(project, 'nowhere', ['beach'])).toBeNull();
  });

  it('uses empty tags gracefully', () => {
    const l = loc.pickLandmarkForVision(project, 'phuket', []);
    expect(l).not.toBeNull();
  });
});
