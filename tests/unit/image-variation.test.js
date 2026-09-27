import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { makeVariation, applyVariationOnBuffer, PROFILES } from '../../agent/image-variation.js';

async function makeJpeg(w = 400, h = 400) {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 128, g: 100, b: 80 } },
  }).jpeg().toBuffer();
}

describe('image-variation.makeVariation', () => {
  it('returns a JPEG buffer', async () => {
    const src = await makeJpeg();
    const { buffer, meta } = await makeVariation(src);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    // JPEG magic
    expect(buffer[0]).toBe(0xff);
    expect(buffer[1]).toBe(0xd8);
    // meta содержит размеры
    expect(meta.originalSize).toEqual([400, 400]);
  });

  it('crops the image: output is 2-8% smaller than input', async () => {
    const src = await makeJpeg(1000, 1000);
    const { buffer } = await makeVariation(src);
    const outMeta = await sharp(buffer).metadata();

    // Соотношение: сжатие от 2% до 8% (crop 3% + небольшая погрешность
    // от rotate / mozjpeg chroma subsampling).
    const ratio = outMeta.width / 1000;
    expect(ratio).toBeGreaterThan(0.92);
    expect(ratio).toBeLessThan(0.98);
    // квадрат остаётся квадратом (± небольшой rotate-induced деформации)
    expect(Math.abs(outMeta.width - outMeta.height)).toBeLessThan(20);
  });

  it('two calls produce different bytes (random)', async () => {
    const src = await makeJpeg();
    const a = await makeVariation(src);
    // маленькая задержка чтобы Math.random не совпал по времени (не обязательно, но безопасно)
    await new Promise(r => setTimeout(r, 5));
    const b = await makeVariation(src);
    // хотя бы meta.brightness или rotate отличаются
    const same = JSON.stringify(a.meta) === JSON.stringify(b.meta);
    expect(same).toBe(false);
  });

  it('respects custom rotateDeg=0', async () => {
    const src = await makeJpeg();
    const { meta } = await makeVariation(src, { rotateDeg: 0 });
    // meta.rotateDeg отсутствует или = 0
    expect(meta.rotateDeg === undefined || Math.abs(meta.rotateDeg) < 0.1).toBe(true);
  });

  it('respects custom cropPercent=0', async () => {
    const src = await makeJpeg(400, 400);
    const { meta } = await makeVariation(src, { cropPercent: 0 });
    expect(meta.cropped).toBe(0);
  });

  it('applies flip when flipHorizontalChance=1', async () => {
    const src = await makeJpeg();
    const { meta } = await makeVariation(src, { flipHorizontalChance: 1 });
    expect(meta.flipped).toBe(true);
  });

  it('never applies flip when chance=0', async () => {
    const src = await makeJpeg();
    for (let i = 0; i < 5; i++) {
      const { meta } = await makeVariation(src, { flipHorizontalChance: 0 });
      expect(meta.flipped).toBeUndefined();
    }
  });

  it('meta reports applied params', async () => {
    const src = await makeJpeg();
    const { meta } = await makeVariation(src);
    expect(meta).toHaveProperty('originalSize');
    expect(meta).toHaveProperty('cropped');
    expect(meta).toHaveProperty('brightness');
    expect(meta).toHaveProperty('saturation');
    expect(meta).toHaveProperty('jpegQuality');
  });
});

describe('image-variation.applyVariationOnBuffer', () => {
  it('requires width and height', async () => {
    const src = await makeJpeg();
    await expect(applyVariationOnBuffer(src, {})).rejects.toThrow(/width и height/);
  });

  it('returns PNG buffer + meta', async () => {
    const src = await makeJpeg(600, 600);
    const { buffer, meta } = await applyVariationOnBuffer(src, { width: 600, height: 600 });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    // PNG magic
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50);
    expect(meta.originalSize).toEqual([600, 600]);
  });

  it('accepts profile option', async () => {
    const src = await makeJpeg(500, 500);
    const { meta } = await applyVariationOnBuffer(src, { width: 500, height: 500, profile: 'strong' });
    expect(meta.cropped).toBeGreaterThanOrEqual(20); // 5% от 500 = 25
  });
});

describe('image-variation.PROFILES', () => {
  it('has subtle, medium, strong', () => {
    expect(PROFILES.subtle).toBeDefined();
    expect(PROFILES.medium).toBeDefined();
    expect(PROFILES.strong).toBeDefined();
  });

  it('subtle has smallest amplitudes', () => {
    expect(PROFILES.subtle.cropPercent).toBeLessThan(PROFILES.medium.cropPercent);
    expect(PROFILES.medium.cropPercent).toBeLessThan(PROFILES.strong.cropPercent);
  });
});


describe('image-processor + variation integration', () => {
  it('processImage returns variation meta when enabled', async () => {
    const { processImage } = await import('../../agent/image-processor.js');
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgproc-'));
    try {
      const input = path.join(tmpDir, 'in.jpg');
      const output = path.join(tmpDir, 'out.jpg');
      fs.writeFileSync(input, await makeJpeg(800, 800));

      const result = await processImage(input, output, {
        targetSize: [500, 500],
        variation: { enabled: true, profile: 'subtle' },
      });

      expect(result.ok).toBe(true);
      expect(result.variation).not.toBeNull();
      expect(result.variation.originalSize).toEqual([500, 500]);
      expect(fs.existsSync(output)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('processImage without variation returns variation: null', async () => {
    const { processImage } = await import('../../agent/image-processor.js');
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgproc-'));
    try {
      const input = path.join(tmpDir, 'in.jpg');
      const output = path.join(tmpDir, 'out.jpg');
      fs.writeFileSync(input, await makeJpeg(400, 400));

      const result = await processImage(input, output, {
        targetSize: [300, 300],
        variation: { enabled: false },
      });

      expect(result.variation).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
