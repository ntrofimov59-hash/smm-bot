import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir;
let sessions;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-'));
  vi.stubEnv('SMM_DATA_DIR', tmpDir);
  vi.resetModules();
  sessions = await import('../../agent/telegram-sessions.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('telegram-sessions — project selection', () => {
  it('getProject returns null initially', () => {
    expect(sessions.getProject(123)).toBeNull();
  });

  it('set + get roundtrip', () => {
    sessions.setProject(123, 'coucou-events');
    expect(sessions.getProject(123)).toBe('coucou-events');
  });

  it('chat ids are strings internally', () => {
    sessions.setProject('-100123', 'a');
    expect(sessions.getProject('-100123')).toBe('a');
    expect(sessions.getProject(-100123)).toBe('a');
  });

  it('update overwrites previous', () => {
    sessions.setProject(1, 'a');
    sessions.setProject(1, 'b');
    expect(sessions.getProject(1)).toBe('b');
  });

  it('clear removes', () => {
    sessions.setProject(1, 'a');
    sessions.clearProject(1);
    expect(sessions.getProject(1)).toBeNull();
  });

  it('different chats isolated', () => {
    sessions.setProject(1, 'a');
    sessions.setProject(2, 'b');
    expect(sessions.getProject(1)).toBe('a');
    expect(sessions.getProject(2)).toBe('b');
  });

  it('persists across module reload', async () => {
    sessions.setProject(1, 'persist');
    vi.resetModules();
    const fresh = await import('../../agent/telegram-sessions.js');
    expect(fresh.getProject(1)).toBe('persist');
  });
});

describe('telegram-sessions.listProjects', () => {
  it('returns directories with project.json', () => {
    const root = path.resolve('projects');
    const projects = sessions.listProjects();
    // у нас на диске точно есть coucou-events
    expect(Array.isArray(projects)).toBe(true);
    expect(projects).toContain('coucou-events');
    // и это действительно директории
    for (const p of projects) {
      expect(fs.existsSync(path.join(root, p, 'project.json'))).toBe(true);
    }
  });
});
