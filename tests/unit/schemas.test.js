import { describe, it, expect } from 'vitest';
import { ProjectSchema, AccountsSchema, InstagramAccountSchema } from '../../agent/schemas.js';

const validProject = {
  slug: 'coucou-events',
  timezone: 'Asia/Yerevan',
  languages: ['ru'],
  publishing: { bestHours: ['11:00', '19:00'] },
};

const validAccount = {
  username: 'u',
  igUserId: '1',
  accessToken: 'IGAAxxxxxxxxxxxxxxxxxx',
};

describe('ProjectSchema — valid', () => {
  it('принимает минимальный валидный проект', () => {
    const r = ProjectSchema.safeParse(validProject);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.timezone).toBe('Asia/Yerevan');
      expect(r.data.publishing.minHoursBetweenPosts).toBe(4); // default
      expect(r.data.publishing.maxHashtags).toBe(12);
    }
  });

  it('применяет defaults для languages/brand/hashtags', () => {
    const r = ProjectSchema.safeParse({
      slug: 'a', timezone: 'UTC', publishing: { bestHours: ['10:00'] },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.languages).toEqual(['ru']);
      expect(r.data.brand).toEqual({ avoid: [] });
      expect(r.data.hashtags).toEqual({ base: [], cities: {}, services: {} });
    }
  });

  it('пропускает неизвестные поля (passthrough)', () => {
    const r = ProjectSchema.safeParse({ ...validProject, customField: 42 });
    expect(r.success).toBe(true);
  });
});

describe('ProjectSchema — invalid', () => {
  it('rejects bad slug', () => {
    for (const bad of ['UPPER', 'with space', '-starts-dash', 'кириллица']) {
      expect(ProjectSchema.safeParse({ ...validProject, slug: bad }).success).toBe(false);
    }
  });

  it('rejects unknown timezone', () => {
    const r = ProjectSchema.safeParse({ ...validProject, timezone: 'Mars/Olympus' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.errors.map(e => e.message).join(' ');
      expect(messages).toMatch(/IANA|timezone/);
    }
  });

  it('rejects malformed bestHours', () => {
    for (const h of ['25:00', '11:60', '11-00', '11', 'abc']) {
      const r = ProjectSchema.safeParse({
        ...validProject, publishing: { bestHours: [h] },
      });
      expect(r.success).toBe(false);
    }
  });

  it('rejects empty bestHours', () => {
    const r = ProjectSchema.safeParse({
      ...validProject, publishing: { bestHours: [] },
    });
    expect(r.success).toBe(false);
  });

  it('rejects missing publishing entirely', () => {
    const { publishing, ...rest } = validProject;
    const r = ProjectSchema.safeParse(rest);
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.errors.map(e => e.path.join('.'));
      expect(paths).toContain('publishing');
    }
  });

  it('rejects hashtags without #', () => {
    const r = ProjectSchema.safeParse({
      ...validProject,
      hashtags: { base: ['no-hash'], cities: {}, services: {} },
    });
    expect(r.success).toBe(false);
  });

  it('rejects maxHashtags > 30', () => {
    const r = ProjectSchema.safeParse({
      ...validProject,
      publishing: { bestHours: ['11:00'], maxHashtags: 50 },
    });
    expect(r.success).toBe(false);
  });
});

describe('InstagramAccountSchema', () => {
  it('принимает валидный аккаунт', () => {
    const r = InstagramAccountSchema.safeParse(validAccount);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.active).toBe(true);
      expect(r.data.cityTags).toEqual([]);
    }
  });

  it('rejects accessToken короче 3 символов', () => {
    const r = InstagramAccountSchema.safeParse({ ...validAccount, accessToken: 'ab' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.errors[0].message).toMatch(/accessToken/);
    }
  });

  it('accepts accessToken длиной 3+ символов (тестовые фикстуры)', () => {
    const r = InstagramAccountSchema.safeParse({ ...validAccount, accessToken: 'tok' });
    expect(r.success).toBe(true);
  });

  it('rejects пустой igUserId', () => {
    expect(InstagramAccountSchema.safeParse({ ...validAccount, igUserId: '' }).success).toBe(false);
  });
});

describe('AccountsSchema', () => {
  it('принимает валидный конфиг', () => {
    const r = AccountsSchema.safeParse({ instagram: [validAccount] });
    expect(r.success).toBe(true);
  });

  it('применяет default для пустого объекта', () => {
    const r = AccountsSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.instagram).toEqual([]);
  });

  it('rejects массив с невалидным аккаунтом', () => {
    const r = AccountsSchema.safeParse({ instagram: [validAccount, { username: 'x' }] });
    expect(r.success).toBe(false);
  });
});
