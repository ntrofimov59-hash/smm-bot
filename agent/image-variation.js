// agent/image-variation.js — рандомизированные преобразования фото.
//
// Цель: сделать каждое изображение уникальным (кроп, поворот, цвет)
// и добавить стиль бренда. Не искажает суть фото — только лёгкие
// эстетические изменения.
//
// Экспорт:
//   - PROFILES — именованные наборы параметров
//   - applyVariationPipeline(sharpInstance, opts) — для встраивания в image-processor
//   - makeVariation(input, opts) — самостоятельный вызов (input → jpeg buffer)
//
// Профили:
//   - subtle (по умолчанию) — минимальные амплитуды, «в тон сайта»
//   - medium — заметнее
//   - strong — для тестов и особых случаев

import sharp from 'sharp';

export const PROFILES = {
  subtle: {
    rotateDeg: 0.8,
    cropPercent: 2,
    brightness: [0.99, 1.04],
    saturation: [0.97, 1.08],
    warmth: [-0.01, 0.04],
    jpegQuality: [90, 94],
    flipHorizontalChance: 0.10,
  },
  medium: {
    rotateDeg: 1.2,
    cropPercent: 3,
    brightness: [0.98, 1.06],
    saturation: [0.95, 1.12],
    warmth: [-0.02, 0.05],
    jpegQuality: [88, 94],
    flipHorizontalChance: 0.15,
  },
  strong: {
    rotateDeg: 2.0,
    cropPercent: 5,
    brightness: [0.95, 1.10],
    saturation: [0.90, 1.20],
    warmth: [-0.04, 0.08],
    jpegQuality: [85, 92],
    flipHorizontalChance: 0.25,
  },
};

export const DEFAULTS = PROFILES.subtle;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pickRange(range) {
  if (Array.isArray(range)) return rand(range[0], range[1]);
  return range;
}

function resolveOpts(opts = {}) {
  let base = DEFAULTS;
  if (typeof opts.profile === 'string' && PROFILES[opts.profile]) {
    base = PROFILES[opts.profile];
  }
  const { profile: _drop, ...rest } = opts;
  return { ...base, ...rest };
}

/**
 * Применяет variation к буферу изображения (уже с известными размерами).
 * Это основной публичный API, используется из image-processor.
 *
 * @param {string|Buffer} input
 * @param {{ width: number, height: number } & Object} opts
 *   Обязательны width и height — размер входного изображения.
 *   Остальное — параметры вариации (можно передать profile).
 * @returns {Promise<{ buffer: Buffer, meta: Object }>}
 */
export async function applyVariationOnBuffer(input, opts = {}) {
  const { width: W, height: H, ...variationOpts } = opts;
  if (!W || !H) throw new Error('applyVariationOnBuffer: нужны width и height');

  const cfg = resolveOpts(variationOpts);

  const img = sharp(input, { failOn: 'none' });

  // 1. Crop с каждой стороны
  const cropPx = Math.round((Math.min(W, H) * cfg.cropPercent) / 100);
  const newW = W - cropPx * 2;
  const newH = H - cropPx * 2;

  const applied = {
    originalSize: [W, H],
    cropped: cropPx,
  };

  let pipeline = img.extract({
    left: cropPx,
    top: cropPx,
    width: newW,
    height: newH,
  });

  // 2. Небольшой поворот (прозрачный фон, потом расширим/догоним размер)
  const rotateDeg = rand(-cfg.rotateDeg, cfg.rotateDeg);
  if (Math.abs(rotateDeg) > 0.05) {
    pipeline = pipeline.rotate(rotateDeg, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
    applied.rotateDeg = Number(rotateDeg.toFixed(2));
  }

  // 3. Цвет
  const brightness = pickRange(cfg.brightness);
  const saturation = pickRange(cfg.saturation);
  const warmth = pickRange(cfg.warmth);

  pipeline = pipeline.modulate({ brightness, saturation });
  applied.brightness = Number(brightness.toFixed(3));
  applied.saturation = Number(saturation.toFixed(3));

  if (Math.abs(warmth) > 0.001) {
    pipeline = pipeline.tint({
      r: Math.round(255 + warmth * 255 * 0.6),
      g: 255,
      b: Math.round(255 - warmth * 255 * 0.6),
    });
    applied.warmth = Number(warmth.toFixed(3));
  }

  // 4. Опционально зеркало
  if (Math.random() < cfg.flipHorizontalChance) {
    pipeline = pipeline.flop();
    applied.flipped = true;
  }

  // 5. Кодируем в PNG (без потерь) — принимающий код сделает jpeg.
  const buffer = await pipeline.png().toBuffer();
  return { buffer, meta: applied };
}

/**
 * Самостоятельный вызов: input → jpeg buffer.
 * Используется в тестах и как API для тех, кому не нужен весь image-processor.
 */
export async function makeVariation(input, opts = {}) {
  const img = sharp(input, { failOn: 'none' });
  const metadata = await img.metadata();
  const W = metadata.width || 1080;
  const H = metadata.height || 1080;

  const { buffer, meta } = await applyVariationOnBuffer(input, {
    ...opts,
    width: W,
    height: H,
  });

  const cfg = resolveOpts(opts);
  const quality = Math.round(pickRange(cfg.jpegQuality));
  const jpegBuf = await sharp(buffer).jpeg({ quality, mozjpeg: true }).toBuffer();

  return { buffer: jpegBuf, meta: { ...meta, jpegQuality: quality } };
}
