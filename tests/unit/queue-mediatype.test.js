// tests/unit/queue-mediatype.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TMP = path.join(os.tmpdir(), 'vitest-queue-mediatype');

// Устанавливаем SMM_DATA_DIR ДО первого импорта queue-json.
// queue-json.js читает env при каждом вызове (кеша нет) — достаточно одного импорта.
process.env.SMM_DATA_DIR = TMP;

import * as queue from '../../agent/queue-json.js';

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const baseItem = (over = {}) => ({
  scheduledAt: new Date(Date.now() - 1000).toISOString(),
  projectSlug: 'test',
  accounts: [{ username: '@test', igUserId: '1', accessToken: 'x' }],
  caption: 'test',
  hashtags: ['#test'],
  ...over,
});

describe('queue mediaType', () => {
  it('дефолт IMAGE если mediaType не задан', () => {
    const it = queue.enqueue(baseItem());
    expect(it.mediaType).toBe('IMAGE');
  });

  it('сохраняет mediaType REELS с videoUrl', () => {
    const it = queue.enqueue(baseItem({
      mediaType: 'REELS',
      videoPath: '/tmp/v.mp4',
      videoUrl: 'https://example.com/v.mp4',
    }));
    expect(it.mediaType).toBe('REELS');
    expect(it.videoUrl).toBe('https://example.com/v.mp4');
    expect(it.videoPath).toBe('/tmp/v.mp4');
  });

  it('сохраняет mediaType STORIES', () => {
    const it = queue.enqueue(baseItem({ mediaType: 'STORIES' }));
    expect(it.mediaType).toBe('STORIES');
  });

  it('updateItem меняет videoProcessingStatus', () => {
    const it = queue.enqueue(baseItem({ mediaType: 'REELS' }));
    queue.updateItem(it.id, { videoProcessingStatus: 'ready' });
    const after = queue.getById(it.id);
    expect(after.videoProcessingStatus).toBe('ready');
  });

  it('мигрирует старые записи — mediaType=IMAGE', () => {
    // Вручную пишем старый формат без mediaType
    const file = path.join(TMP, 'queue.json');
    fs.writeFileSync(file, JSON.stringify({
      items: [{
        id: 'old-1', status: 'pending',
        scheduledAt: new Date().toISOString(),
        accounts: [], caption: 'x', hashtags: [],
        attempts: 0, publishedPostIds: [],
      }],
    }));
    const items = queue.getUpcoming();
    expect(items[0].mediaType).toBe('IMAGE');
  });
});
