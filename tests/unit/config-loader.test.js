import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadProject, loadAccounts } from '../../agent/config-loader.js';
import { ConfigError } from '../../agent/schemas.js';

let tmpDir;

const validProject = {
  slug: 'demo',
  timezone: 'Asia/Yerevan',
  publishing: { bestHours: ['11:00'] },
};

const validAccount = {
  username: 'u',
  igUserId: '1',
  accessToken: 'IGAAxxxxxxxxxxxxxxxxxx',
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('config-loader.loadProject', () => {
  it('читает и валидирует валидный project.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'project.json'), JSON.stringify(validProject));
    const p = loadProject(tmpDir);
    expect(p.slug).toBe('demo');
  });

  it('throws if file missing', () => {
    expect(() => loadProject(tmpDir)).toThrow(/project.json не найден/);
  });

  it('throws on malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'project.json'), '{not-json');
    expect(() => loadProject(tmpDir)).toThrow(/невалидный JSON/);
  });

  it('throws ConfigError with path for invalid slug', () => {
    fs.writeFileSync(path.join(tmpDir, 'project.json'),
      JSON.stringify({ ...validProject, slug: 'BAD SLUG' }));
    expect(() => loadProject(tmpDir)).toThrow(ConfigError);
    try {
      loadProject(tmpDir);
    } catch (e) {
      expect(e.message).toContain('slug');
      expect(e.zodErrors.length).toBeGreaterThan(0);
    }
  });

  it('Collects ALL errors, not just first', () => {
    fs.writeFileSync(path.join(tmpDir, 'project.json'), JSON.stringify({
      slug: 'BAD',                    // bad
      timezone: 'Unknown/Zone',       // bad
      publishing: { bestHours: [] },  // bad
    }));
    try {
      loadProject(tmpDir);
    } catch (e) {
      expect(e.zodErrors.length).toBeGreaterThanOrEqual(3);
      const paths = e.zodErrors.map(x => x.path.join('.'));
      expect(paths).toContain('slug');
      expect(paths).toContain('timezone');
      expect(paths).toContain('publishing.bestHours');
    }
  });
});

describe('config-loader.loadAccounts', () => {
  it('returns null when file missing', () => {
    expect(loadAccounts(tmpDir)).toBeNull();
  });

  it('reads and validates valid accounts', () => {
    fs.writeFileSync(path.join(tmpDir, 'accounts.json'),
      JSON.stringify({ instagram: [validAccount] }));
    const a = loadAccounts(tmpDir);
    expect(a.instagram).toHaveLength(1);
    expect(a.instagram[0].active).toBe(true);
  });

  it('throws ConfigError for bad account', () => {
    fs.writeFileSync(path.join(tmpDir, 'accounts.json'),
      JSON.stringify({ instagram: [{ username: 'x' }] }));
    expect(() => loadAccounts(tmpDir)).toThrow(ConfigError);
  });
});
