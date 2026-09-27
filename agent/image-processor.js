// agent/image-processor.js — единая стилистика + вотермарка для всех фото
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

/**
 * Обрабатывает изображение:
 *  1. Приводит к квадрату 1080×1080 (Instagram формат)
 *  2. Применяет фирменный фильтр (тёплый, яркий, насыщенный)
 *  3. Добавляет вотермарку в углу
 *
 * @param {string} inputPath  — исходное фото
 * @param {string} outputPath — куда сохранить
 * @param {Object} settings   — секция imageProcessing из project.json
 * @returns {Promise<{ok, output, width, height, sizeKB}>}
 */
export async function processImage(inputPath, outputPath, settings = {}) {
  const {
    targetSize = [1080, 1080],
    filter = { brightness: 1.05, saturation: 1.1, warmth: 0.03 },
    watermark = { enabled: false },
    logo = { enabled: false },
  } = settings;

  const [W, H] = targetSize;

  // 1. Читаем и ресайзим
  let img = sharp(inputPath).rotate(); // авто-поворот по EXIF

  // 2. Квадрат + resize. Стратегия: cover — обрезаем по центру
  img = img.resize(W, H, { fit: 'cover', position: 'attention' });

  // 3. Фильтр: яркость / насыщенность / тёплый оттенок
  // sharp поддерживает .modulate() для brightness и saturation
  const modulateOpts = {};
  if (filter.brightness && filter.brightness !== 1) modulateOpts.brightness = filter.brightness;
  if (filter.saturation && filter.saturation !== 1) modulateOpts.saturation = filter.saturation;
  if (Object.keys(modulateOpts).length) img = img.modulate(modulateOpts);

  // Тёплый оттенок: tint() — добавляет оттенок, но может сделать слишком «жёлтым».
  // Используем лёгкий linear-корректор по каналам R/B
  if (filter.warmth && filter.warmth > 0) {
    const warmth = Math.min(filter.warmth, 0.1); // не более 10%
    img = img.linear(1 + warmth, -(warmth * 128)); // подкручиваем RGB линейно
  }

  // 4. Вотермарка-текст
  if (watermark.enabled && watermark.text) {
    const svg = buildWatermarkSvg(watermark, W, H);
    img = img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]);
  }

  // 5. Логотип (если задан файл) — с прозрачностью, тенью и отступами
  if (logo.enabled && logo.path && fs.existsSync(logo.path)) {
    const logoSettings = {
      size: logo.size || null,
      height: logo.height || null,
      opacity: logo.opacity ?? 0.9,
      position: logo.position || 'bottom-right',
      padding: logo.padding ?? 32,
      shadow: !!logo.shadow,
    };

    // Определяем ресайз: height (для горизонтальных) или size (для квадратных)
    let resizeOpts;
    if (logoSettings.height) {
      resizeOpts = { height: logoSettings.height, withoutEnlargement: false };
    } else {
      resizeOpts = { width: logoSettings.size || 120, height: logoSettings.size || 120, fit: 'inside', withoutEnlargement: true };
    }

    let logoBuf = await sharp(logo.path)
      .resize(resizeOpts)
      .ensureAlpha()
      .png()
      .toBuffer();

    // Если нужна прозрачность < 1 — модифицируем альфа-канал
    if (logoSettings.opacity < 1) {
      logoBuf = await sharp(logoBuf)
        .composite([{
          input: Buffer.from([255, 255, 255, Math.round(logoSettings.opacity * 255)]),
          raw: { width: 1, height: 1, channels: 4 },
          tile: true,
          blend: 'dest-in',
        }])
        .png()
        .toBuffer();
    }

    const logoMeta = await sharp(logoBuf).metadata();
    const pad = logoSettings.padding;

    // Координаты с отступом
    const pos = logoPositions(logoSettings.position, W, H, logoMeta.width, logoMeta.height, pad);

    const composites = [];

    // Опционально: тень под логотип (для читаемости на светлых фото)
    if (logoSettings.shadow) {
      // Создаём чёрную копию того же логотипа с той же альфа-формой
      const blackCanvas = await sharp({
        create: {
          width: logoMeta.width,
          height: logoMeta.height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const shadowBuf = await sharp(blackCanvas)
        .composite([{
          input: logoBuf,
          blend: 'dest-in', // оставляем чёрные пиксели только там, где у лого есть alpha
        }])
        .blur(8)
        .png()
        .toBuffer();

      // Смещаем тень на 3px, под лого
      composites.push({ input: shadowBuf, top: pos.top + 3, left: pos.left + 3 });
    }

    composites.push({ input: logoBuf, top: pos.top, left: pos.left });

    img = img.composite(composites);
  }

  // 6. Сохраняем как JPEG высокого качества
  await img
    .jpeg({ quality: 92, progressive: true, mozjpeg: true })
    .toFile(outputPath);

  const stat = fs.statSync(outputPath);
  return {
    ok: true,
    output: outputPath,
    width: W,
    height: H,
    sizeKB: Math.round(stat.size / 1024),
  };
}

function logoPositions(position, W, H, logoW, logoH, pad) {
  switch (position) {
    case 'top-left':     return { top: pad,            left: pad };
    case 'top-right':    return { top: pad,            left: W - logoW - pad };
    case 'bottom-left':  return { top: H - logoH - pad, left: pad };
    case 'center':       return { top: Math.round((H - logoH) / 2), left: Math.round((W - logoW) / 2) };
    case 'bottom-right':
    default:             return { top: H - logoH - pad, left: W - logoW - pad };
  }
}

function positionToGravity(pos) {
  const map = {
    'top-left': 'northwest',
    'top-right': 'northeast',
    'bottom-left': 'southwest',
    'bottom-right': 'southeast',
    'center': 'center',
  };
  return { gravity: map[pos] || 'southeast' };
}

function buildWatermarkSvg({ text, fontSize = 24, opacity = 0.65, position = 'bottom-right', padding = 24, noBackground = false }, W, H) {
  const fontFamily = 'Inter, Arial, sans-serif';
  const estimatedWidth = text.length * fontSize * 0.6;
  const boxH = fontSize + 16;
  const boxW = estimatedWidth + 24;

  let x, y;
  switch (position) {
    case 'top-left':
      x = padding; y = padding; break;
    case 'top-right':
      x = W - boxW - padding; y = padding; break;
    case 'bottom-left':
      x = padding; y = H - boxH - padding; break;
    case 'bottom-right':
    default:
      x = W - boxW - padding; y = H - boxH - padding;
  }

  const bgRect = noBackground
    ? ''
    : `<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="6" ry="6" fill="rgba(0,0,0,${(opacity * 0.5).toFixed(2)})" />`;

  // Тень для читаемости без плашки
  const shadow = noBackground
    ? `<text x="${x + 2}" y="${y + boxH / 2 + fontSize / 3 + 2}" font-family="${fontFamily}" font-size="${fontSize}" fill="rgba(0,0,0,${(opacity * 0.4).toFixed(2)})">${escapeXml(text)}</text>`
    : '';

  return `<svg width="${W}" height="${H}">
    ${bgRect}
    ${shadow}
    <text x="${x + 12}" y="${y + boxH / 2 + fontSize / 3}" font-family="${fontFamily}" font-size="${fontSize}" fill="rgba(255,255,255,${opacity})">${escapeXml(text)}</text>
  </svg>`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

/**
 * Обрабатывает массив файлов и возвращает массив результатов.
 */
export async function processBatch(items, settings = {}) {
  const results = [];
  for (const item of items) {
    try {
      const r = await processImage(item.input, item.output, settings);
      results.push({ ...r, input: item.input });
    } catch (e) {
      results.push({ ok: false, input: item.input, error: e.message });
    }
  }
  return results;
}
