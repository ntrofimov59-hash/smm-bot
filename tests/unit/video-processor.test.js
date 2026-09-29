// tests/unit/video-processor.test.js
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { checkFfmpeg, probeVideo, processVideo, extractFrame } from '../../agent/video-processor.js';

const TMP = '/tmp/vitest-video';
const INPUT = path.join(TMP, 'input.mp4');
const OUTPUT = path.join(TMP, 'output.mp4');
const FRAME = path.join(TMP, 'frame.jpg');

beforeAll(() => {
  fs.mkdirSync(TMP, { recursive: true });
  if (!fs.existsSync(INPUT)) {
    // 3-секундное тестовое видео 1280x720
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=3:size=1280x720:rate=30 ` +
      `-f lavfi -i sine=frequency=440:duration=3 ` +
      `-c:v libx264 -c:a aac -pix_fmt yuv420p ${INPUT} 2>/dev/null`
    );
  }
}, 30000);

describe('video-processor', () => {
  it('checkFfmpeg возвращает ok', async () => {
    const r = await checkFfmpeg();
    expect(r.ok).toBe(true);
  });

  it('probeVideo читает метаданные', async () => {
    const meta = await probeVideo(INPUT);
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(720);
    expect(meta.duration).toBeGreaterThan(2);
    expect(meta.codec).toBe('h264');
  });

  it('probeVideo бросает для несуществующего файла', async () => {
    await expect(probeVideo('/tmp/nonexistent-xyz.mp4')).rejects.toThrow();
  });

  it('processVideo приводит к 1080x1920', async () => {
    const r = await processVideo({
      inputPath: INPUT,
      outputPath: OUTPUT,
      settings: { targetWidth: 1080, targetHeight: 1920, maxDurationSec: 90 },
      watermarkPath: null,
    });
    expect(r.ok).toBe(true);
    expect(r.width).toBe(1080);
    expect(r.height).toBe(1920);
    expect(fs.existsSync(OUTPUT)).toBe(true);
  }, 30000);

  it('processVideo возвращает ошибку для несуществующего входа', async () => {
    const r = await processVideo({
      inputPath: '/tmp/nope.mp4',
      outputPath: '/tmp/nope-out.mp4',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/не найден/);
  });

  it('extractFrame создаёт jpg', async () => {
    const r = await extractFrame(OUTPUT, FRAME, 1);
    expect(r.ok).toBe(true);
    expect(fs.existsSync(FRAME)).toBe(true);
    expect(r.sizeKB).toBeGreaterThan(0);
  }, 15000);
});
