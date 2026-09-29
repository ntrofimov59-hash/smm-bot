// agent/video-processor.js — обработка видео для Reels/Stories через ffmpeg
//
// Вход: произвольный видеофайл (mp4/mov/avi/mkv)
// Выход: 9:16, 1080x1920, H.264 + AAC, mp4 — формат Instagram Reels/Stories
//
// Вотермарка: PNG-лого в правом нижнем углу (настраивается через project.json)
//
// Зависимости: ffmpeg, ffprobe (устанавливаются: apt install ffmpeg)

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Запускает ffmpeg/ffprobe с аргументами, возвращает {stdout, stderr, code}.
 * Без shell — защита от инъекций в путях.
 */
function runFf(bin, args, { captureStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    if (captureStdout && proc.stdout) {
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
    }
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

/**
 * Проверка наличия ffmpeg и ffprobe в PATH.
 */
export async function checkFfmpeg() {
  try {
    const ffmpeg = await runFf('ffmpeg', ['-version'], { captureStdout: true });
    const ffprobe = await runFf('ffprobe', ['-version'], { captureStdout: true });
    if (ffmpeg.code !== 0 || ffprobe.code !== 0) return { ok: false, error: 'ffmpeg/ffprobe exit code != 0' };
    // ffmpeg пишет версию в stdout
    const ver = (ffmpeg.stdout.split('\n')[0] || ffmpeg.stderr.split('\n')[0] || 'unknown').trim();
    return { ok: true, version: ver };
  } catch (e) {
    return { ok: false, error: `ffmpeg не найден: ${e.message}` };
  }
}

/**
 * Возвращает метаданные видео: duration (сек), width, height, codec.
 */
export async function probeVideo(inputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`probeVideo: файл не найден ${inputPath}`);
  }
  const { stdout, code } = await runFf('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,duration,codec_name',
    '-show_entries', 'format=duration',
    '-of', 'json',
    inputPath,
  ], { captureStdout: true });

  if (code !== 0) throw new Error(`ffprobe exited ${code}`);
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0] || {};
  const duration = Number(stream.duration || data.format?.duration || 0);
  return {
    width: Number(stream.width || 0),
    height: Number(stream.height || 0),
    duration,
    codec: stream.codec_name || null,
  };
}

/**
 * Обрабатывает видео: обрезает по длительности, ресайзит под 9:16, накладывает вотермарку.
 *
 * @param {Object} opts
 * @param {string} opts.inputPath   — исходное видео
 * @param {string} opts.outputPath  — куда сохранить mp4
 * @param {Object} opts.settings    — publishing.video из project.json
 * @param {string} opts.watermarkPath — путь к PNG-лого (для вотермарки)
 * @returns {Promise<{ok, output, width, height, durationSec, sizeKB, meta}>}
 */
export async function processVideo({ inputPath, outputPath, settings = {}, watermarkPath = null }) {
  const {
    targetWidth = 1080,
    targetHeight = 1920,
    watermarkPosition = 'bottom-right',
    watermarkPadding = 32,
    watermarkHeight = 120,
    maxDurationSec = 90,
  } = settings;

  if (!fs.existsSync(inputPath)) {
    return { ok: false, error: `входной файл не найден: ${inputPath}` };
  }

  const meta = await probeVideo(inputPath);

  // Готовим фильтры
  const filters = [];

  // 1. Ресайз + паддинг под 9:16. Если видео горизонтальное — вписываем по ширине,
  //    пустоты заливаем чёрным (или можно блюрить, но это дорого).
  //    scale=...:force_original_aspect_ratio=decrease + pad
  filters.push(
    `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`,
    `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black`,
  );

  // 2. Вотермарка — если лого есть
  const wm = (watermarkPath && fs.existsSync(watermarkPath)) ? watermarkPath : null;
  if (wm) {
    // overlayPosition: bottom-right = W-w-{pad}:H-h-{pad}
    const map = {
      'bottom-right': `W-w-${watermarkPadding}:H-h-${watermarkPadding}`,
      'bottom-left':  `${watermarkPadding}:H-h-${watermarkPadding}`,
      'top-right':    `W-w-${watermarkPadding}:${watermarkPadding}`,
      'top-left':     `${watermarkPadding}:${watermarkPadding}`,
    };
    const overlayXY = map[watermarkPosition] || map['bottom-right'];
    filters.push(`[1:v]scale=-1:${watermarkHeight}[wm]`);
    filters.push(`[base][wm]overlay=${overlayXY}[out]`);
  }

  // Собираем -vf (или -filter_complex для overlay)
  const args = ['-y', '-i', inputPath];
  if (wm) {
    args.push('-i', wm);
  }

  if (maxDurationSec && meta.duration > maxDurationSec) {
    args.push('-t', String(maxDurationSec));
  }

  if (wm) {
    // Разделяем цепочку: pad-фильтры идут в [base], overlay в [out]
    // Первые два фильтра применяются к основному видео до overlay
    const [scaleF, padF, ...rest] = filters;
    const baseChain = `[0:v]${scaleF},${padF}[base]`;
    const wmChain = rest.join(';');
    args.push('-filter_complex', `${baseChain};${wmChain}`, '-map', '[out]', '-map', '0:a?');
  } else {
    args.push('-vf', filters.join(','));
  }

  // Кодек: H.264 (libx264) + AAC, faststart для стриминга
  args.push(
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-r', '30',
    outputPath,
  );

  const { code, stderr } = await runFf('ffmpeg', args);
  if (code !== 0) {
    return { ok: false, error: `ffmpeg exited ${code}: ${stderr.slice(-300)}` };
  }

  if (!fs.existsSync(outputPath)) {
    return { ok: false, error: 'output не создан ffmpeg' };
  }

  const sizeKB = Math.round(fs.statSync(outputPath).size / 1024);
  const outMeta = await probeVideo(outputPath);

  return {
    ok: true,
    output: outputPath,
    width: outMeta.width,
    height: outMeta.height,
    durationSec: Math.round(outMeta.duration),
    sizeKB,
    meta,
  };
}

/**
 * Извлекает кадр из видео — для vision-анализа (описание контента).
 *
 * @param {string} videoPath
 * @param {string} outputPath — куда сохранить .jpg
 * @param {number} atSec      — на какой секунде (по умолчанию 1)
 */
export async function extractFrame(videoPath, outputPath, atSec = 1) {
  if (!fs.existsSync(videoPath)) {
    return { ok: false, error: `файл не найден: ${videoPath}` };
  }
  const args = [
    '-y',
    '-ss', String(atSec),
    '-i', videoPath,
    '-vframes', '1',
    '-q:v', '3',
    outputPath,
  ];
  const { code, stderr } = await runFf('ffmpeg', args);
  if (code !== 0) {
    return { ok: false, error: `ffmpeg exited ${code}: ${stderr.slice(-200)}` };
  }
  if (!fs.existsSync(outputPath)) {
    return { ok: false, error: 'кадр не создан' };
  }
  return { ok: true, output: outputPath, sizeKB: Math.round(fs.statSync(outputPath).size / 1024) };
}
