import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const project = {
  hashtags: {
    base: ['#coucou', '#events'],
    cities: {
      phuket: ['#phuket', '#thailand', '#beachlife'],
      yerevan: ['#yerevan', '#armenia'],
    },
    services: {
      wedding: ['#wedding', '#bride'],
      corporate: ['#corporate', '#business'],
    },
  },
};

let tmpDir;
let buildHashtags;
let resetRotation;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hashtags-'));
  vi.stubEnv('SMM_DATA_DIR', tmpDir);
  vi.resetModules();
  const mod = await import('../../agent/hashtags.js');
  buildHashtags = mod.buildHashtags;
  resetRotation = mod.resetRotation;
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('hashtags.buildHashtags', () => {
  it('всегда включает базовые хештеги', () => {
    const r = buildHashtags({ project });
    expect(r).toContain('#coucou');
    expect(r).toContain('#events');
  });

  it('добавляет хештеги города', () => {
    const r = buildHashtags({ project, city: 'phuket' });
    expect(r).toContain('#phuket');
    expect(r).toContain('#thailand');
  });

  it('не добавляет хештеги чужого города', () => {
    const r = buildHashtags({ project, city: 'phuket' });
    expect(r).not.toContain('#armenia');
  });

  it('добавляет хештеги услуги', () => {
    const r = buildHashtags({ project, city: 'phuket', service: 'wedding' });
    expect(r).toContain('#wedding');
    expect(r).toContain('#bride');
  });

  it('добавляет llmHashtags', () => {
    const r = buildHashtags({ project, llmHashtags: ['#ai', '#generated'] });
    expect(r).toContain('#ai');
    expect(r).toContain('#generated');
  });

  it('добавляет vision-теги с нормализацией', () => {
    const r = buildHashtags({ project, imageTags: ['sunny day', 'beach'] });
    expect(r).toContain('#sunnyday'); // пробел удалён
    expect(r).toContain('#beach');
  });

  it('соблюдает max', () => {
    const r = buildHashtags({ project, city: 'phuket', service: 'wedding', max: 3 });
    expect(r).toHaveLength(3);
  });

  it('дедуплицирует одинаковые хештеги', () => {
    const r = buildHashtags({
      project,
      city: 'phuket',
      llmHashtags: ['#coucou'], // дубликат базового
    });
    const coucouCount = r.filter(t => t === '#coucou').length;
    expect(coucouCount).toBe(1);
  });

  it('ротация: повторный вызов не даёт тех же city-тегов', () => {
    const r1 = buildHashtags({ project, city: 'phuket', max: 12 });
    const r2 = buildHashtags({ project, city: 'phuket', max: 12 });
    // базовые могут повториться, city — не должны
    const cityTags1 = r1.filter(t => ['#phuket', '#thailand', '#beachlife'].includes(t));
    const cityTags2 = r2.filter(t => ['#phuket', '#thailand', '#beachlife'].includes(t));
    if (cityTags1.length > 0) {
      expect(cityTags2.length).toBe(0);
    }
  });

  it('неизвестный город → только base + llm', () => {
    const r = buildHashtags({ project, city: 'unknown', llmHashtags: ['#test'] });
    expect(r).toContain('#coucou');
    expect(r).toContain('#test');
    expect(r).not.toContain('#phuket');
  });

  it('пустой project.hashtags → возвращает llmHashtags', () => {
    const r = buildHashtags({ project: {}, llmHashtags: ['#only'] });
    expect(r).toEqual(['#only']);
  });
});

describe('hashtags.resetRotation', () => {
  it('сбрасывает историю ротации', async () => {
    buildHashtags({ project, city: 'phuket' });
    resetRotation();
    // после сброса — city-теги снова доступны
    const r = buildHashtags({ project, city: 'phuket' });
    expect(r).toContain('#phuket');
  });
});
