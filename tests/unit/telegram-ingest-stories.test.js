// tests/unit/telegram-ingest-stories.test.js
// Проверяем маршрутизацию #stories → inbox-stories/

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Мокаем telegram-api ДО импорта ingest
vi.mock('../../agent/telegram-api.js', () => ({
  getUpdates: vi.fn().mockResolvedValue([]),
  sendMessage: vi.fn().mockResolvedValue({ ok: true }),
  downloadByFileId: vi.fn().mockResolvedValue(Buffer.from('fake-image-data-'.repeat(20))),
}));

// Мокаем telegram-sessions
vi.mock('../../agent/telegram-sessions.js', () => ({
  setProject: vi.fn(),
  getProject: vi.fn(() => 'coucou-events'),
  listProjects: vi.fn(() => ['coucou-events']),
  clearProject: vi.fn(),
}));

const TMP = path.join(os.tmpdir(), 'vitest-ingest-stories-' + Date.now());
process.env.PROJECTS_ROOT = TMP;
process.env.TELEGRAM_INGEST_USERS = '';  // пусто — allow all

fs.mkdirSync(path.join(TMP, 'coucou-events'), { recursive: true });
fs.writeFileSync(
  path.join(TMP, 'coucou-events', 'project.json'),
  JSON.stringify({ slug: 'coucou-events', timezone: 'UTC' })
);

const { processUpdate } = await import('../../agent/telegram-ingest.js');

function makePhotoUpdate(caption) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: 12345 },
      from: { id: 999 },
      photo: [
        { file_id: 'small', file_size: 100, width: 100, height: 100 },
        { file_id: 'large', file_size: 5000, width: 800, height: 800 },
      ],
      caption,
    },
  };
}

function makeDocUpdate(fileName, caption) {
  return {
    update_id: 2,
    message: {
      message_id: 2,
      chat: { id: 12345 },
      from: { id: 999 },
      document: {
        file_id: 'doc-1',
        file_name: fileName,
        file_size: 5000,
        mime_type: 'image/jpeg',
      },
      caption,
    },
  };
}

function makeVideoUpdate(fileName, caption) {
  return {
    update_id: 3,
    message: {
      message_id: 3,
      chat: { id: 12345 },
      from: { id: 999 },
      document: {
        file_id: 'vid-1',
        file_name: fileName,
        file_size: 50000,
        mime_type: 'video/mp4',
      },
      caption,
    },
  };
}

beforeEach(() => {
  // Чистим inbox и inbox-stories
  for (const sub of ['inbox', 'inbox-stories']) {
    const d = path.join(TMP, 'coucou-events', sub);
    if (fs.existsSync(d)) {
      for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
    }
  }
});

afterEach(() => {
  // чистим
  for (const sub of ['inbox', 'inbox-stories']) {
    const d = path.join(TMP, 'coucou-events', sub);
    if (fs.existsSync(d)) {
      for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
    }
  }
});

describe('telegram-ingest #stories routing', () => {
  it('обычное фото без подписи → inbox/', async () => {
    const r = await processUpdate(makePhotoUpdate(''));
    expect(r.ok).toBe(true);
    expect(r.subdir).toBe('inbox');
    const files = fs.readdirSync(path.join(TMP, 'coucou-events', 'inbox'));
    expect(files.length).toBe(1);
  });

  it('фото с #stories → inbox-stories/', async () => {
    const r = await processUpdate(makePhotoUpdate('Наш новый проект #stories'));
    expect(r.ok).toBe(true);
    expect(r.subdir).toBe('inbox-stories');
    const files = fs.readdirSync(path.join(TMP, 'coucou-events', 'inbox-stories'));
    expect(files.length).toBe(1);
  });

  it('#Stories регистронезависимо', async () => {
    const r = await processUpdate(makePhotoUpdate('Review #Stories'));
    expect(r.subdir).toBe('inbox-stories');
  });

  it('документ .jpg с #stories → inbox-stories/', async () => {
    const r = await processUpdate(makeDocUpdate('photo.jpg', '#stories с мероприятия'));
    expect(r.subdir).toBe('inbox-stories');
    expect(r.kind).toBe('image');
  });

  it('документ .mp4 → inbox/ и kind=video', async () => {
    const r = await processUpdate(makeVideoUpdate('clip.mp4', 'beautiful wedding'));
    expect(r.ok).toBe(true);
    expect(r.subdir).toBe('inbox');
    expect(r.kind).toBe('video');
  });

  it('документ .mp4 с #stories → inbox-stories/ и kind=video', async () => {
    const r = await processUpdate(makeVideoUpdate('clip.mp4', 'backstage #stories'));
    expect(r.ok).toBe(true);
    expect(r.subdir).toBe('inbox-stories');
    expect(r.kind).toBe('video');
  });

  it('документ с неподдерживаемым расширением → skipped', async () => {
    const r = await processUpdate(makeDocUpdate('doc.pdf', ''));
    expect(r.ok).toBe(true);
    expect(r.saved).toBe(0);
    expect(r.skipped).toBe(1);
  });
});
