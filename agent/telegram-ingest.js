// agent/telegram-ingest.js — Telegram-бот приёма фото.
//
// Что делает:
//   - Long-polling getUpdates
//   - Принимает: photo (сжатые), document (оригиналы), albums, .zip архивы
//   - Сохраняет в projects/<slug>/inbox/
//   - Whitelist по user_id (env TELEGRAM_INGEST_USERS)
//   - Команды: /start /help /project /projects /current
//   - Роутинг: #slug в caption → session → default
//
// Не делает: генерацию подписей, публикацию. Это работа scanner + scheduler.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import unzipper from 'unzipper';
import { getUpdates, sendMessage, downloadByFileId } from './telegram-api.js';
import { setProject, getProject, listProjects } from './telegram-sessions.js';

const PROJECTS_ROOT = path.resolve(new URL('../projects/', import.meta.url).pathname);

// Расширения картинок, которые принимаем. HEIC пока не поддерживается (нужен libheif).
const IMAGE_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.tif', '.bmp',
]);

const UNSUPPORTED_EXT = new Set(['.heic', '.heif']);

function getWhitelist() {
  return (process.env.TELEGRAM_INGEST_USERS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}

function getDefaultProject() {
  return process.env.TELEGRAM_INGEST_DEFAULT_PROJECT || null;
}

function isAllowed(userId) {
  const list = getWhitelist();
  if (!list.length) return true; // если пусто — dev-режим
  return list.includes(String(userId));
}

function uniqueFilename() {
  const ts = Date.now();
  const rand = crypto.randomBytes(4).toString('hex');
  return `${ts}-tg-${rand}`;
}

function ensureInbox(projectSlug) {
  const dir = path.join(PROJECTS_ROOT, projectSlug, 'inbox');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Роутинг: какой проект использовать для этого сообщения.
 * 1. #slug в caption
 * 2. активная сессия
 * 3. TELEGRAM_INGEST_DEFAULT_PROJECT
 */
function resolveProject(message, chatId) {
  const caption = message.caption || '';
  const tagMatch = caption.match(/#([a-z0-9][a-z0-9-]*)/i);
  if (tagMatch) {
    const candidate = tagMatch[1].toLowerCase();
    if (listProjects().includes(candidate)) return candidate;
  }
  const session = getProject(chatId);
  if (session) return session;
  return getDefaultProject();
}

async function reply(chatId, text, opts = {}) {
  try {
    await sendMessage(chatId, text, opts);
  } catch (e) {
    console.warn('telegram-ingest: reply failed:', e.message);
  }
}

async function handleCommand(message) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();
  const [cmd, ...args] = text.split(/\s+/);

  const command = cmd.replace(/@\S+$/, '').toLowerCase();

  if (command === '/start' || command === '/help') {
    const projects = listProjects();
    const active = getProject(chatId);
    const lines = [
      '📥 <b>Coucou Ingest</b> — бот приёма фото.',
      '',
      'Как использовать:',
      '1. Выбери проект: <code>/project coucou-events</code>',
      '2. Кидай фото, документы или .zip — попадут в inbox',
      '3. Дальше бот сам: vision → caption → планирование → Instagram',
      '',
      'Фишка: <code>#slug</code> в подписи переключает проект на одно сообщение.',
      '',
      `Проектов найдено: <b>${projects.length}</b>`,
      projects.length ? `<code>${projects.join(', ')}</code>` : '—',
      '',
      `Активный: <b>${active || '—'}</b>`,
    ];
    return reply(chatId, lines.join('\n'));
  }

  if (command === '/projects') {
    const projects = listProjects();
    if (!projects.length) return reply(chatId, 'Пока нет ни одного проекта в projects/');
    const active = getProject(chatId);
    const list = projects.map(p => p === active ? `• <b>${p}</b> ← активный` : `• ${p}`).join('\n');
    return reply(chatId, `📂 Проекты:\n${list}`);
  }

  if (command === '/current') {
    const active = getProject(chatId);
    return reply(chatId, active ? `🎯 Активный проект: <b>${active}</b>` : 'Проект не выбран. /project &lt;slug&gt;');
  }

  if (command === '/project') {
    const slug = (args[0] || '').toLowerCase();
    if (!slug) return reply(chatId, 'Использование: /project &lt;slug&gt;');
    if (!listProjects().includes(slug)) {
      const projects = listProjects().join(', ');
      return reply(chatId, `Проект <b>${slug}</b> не найден.\nДоступные: ${projects || '—'}`);
    }
    setProject(chatId, slug);
    return reply(chatId, `🎯 Активный проект: <b>${slug}</b>`);
  }

  return reply(chatId, `Неизвестная команда: ${cmd}\n/help — справка`);
}

/**
 * Принимает один photo (сжатое Telegram-фото).
 */
async function handlePhoto(message, projectSlug, opts) {
  const photos = message.photo || [];
  if (!photos.length) return { saved: 0 };
  const largest = photos[photos.length - 1];

  const buf = await downloadByFileId(largest.file_id, opts);
  const dir = ensureInbox(projectSlug);
  const filename = uniqueFilename() + '.jpg';
  fs.writeFileSync(path.join(dir, filename), buf);
  return { saved: 1, filename, sizeBytes: buf.length };
}

/**
 * Принимает document (оригинал файла) или .zip-архив.
 */
async function handleDocument(message, projectSlug, opts) {
  const doc = message.document;
  if (!doc) return { saved: 0 };

  const fileName = doc.file_name || 'file';
  const ext = path.extname(fileName).toLowerCase();

  // ZIP
  if (ext === '.zip' || doc.mime_type === 'application/zip') {
    return handleZip(message, projectSlug, opts);
  }

  // HEIC — не поддерживаем пока
  if (UNSUPPORTED_EXT.has(ext)) {
    return { saved: 0, skipped: 1, reason: `unsupported format ${ext}` };
  }

  if (!IMAGE_EXT.has(ext)) {
    return { saved: 0, skipped: 1, reason: `not an image (${ext || doc.mime_type})` };
  }

  const buf = await downloadByFileId(doc.file_id, opts);
  const dir = ensureInbox(projectSlug);
  const outExt = ext === '.jpeg' ? '.jpg' : ext;
  const filename = uniqueFilename() + outExt;
  fs.writeFileSync(path.join(dir, filename), buf);
  return { saved: 1, filename, sizeBytes: buf.length };
}

/**
 * Скачивает .zip и извлекает из него все картинки в inbox проекта.
 */
async function handleZip(message, projectSlug, opts) {
  const doc = message.document;
  const buf = await downloadByFileId(doc.file_id, opts);
  const dir = ensureInbox(projectSlug);

  let zip;
  try {
    zip = await unzipper.Open.buffer(buf);
  } catch (e) {
    return { saved: 0, failed: 1, reason: `zip parse: ${e.message}` };
  }

  const saved = [];
  const skipped = [];

  for (const entry of zip.files) {
    if (entry.type !== 'File') continue;

    // пропускаем macOS-мусор
    if (entry.path.startsWith('__MACOSX/') || entry.path.endsWith('.DS_Store')) continue;

    const ext = path.extname(entry.path).toLowerCase();
    if (UNSUPPORTED_EXT.has(ext)) { skipped.push({ name: entry.path, reason: 'unsupported' }); continue; }
    if (!IMAGE_EXT.has(ext)) { skipped.push({ name: entry.path, reason: 'not image' }); continue; }

    // защита от zip-bomb: не более 20 MB на файл
    const declaredSize = entry.uncompressedSize || 0;
    if (declaredSize > 20 * 1024 * 1024) {
      skipped.push({ name: entry.path, reason: 'too large' });
      continue;
    }

    const data = await entry.buffer();
    if (data.length > 20 * 1024 * 1024) {
      skipped.push({ name: entry.path, reason: 'too large after extract' });
      continue;
    }

    const outExt = ext === '.jpeg' ? '.jpg' : ext;
    const filename = uniqueFilename() + outExt;
    fs.writeFileSync(path.join(dir, filename), data);
    saved.push({ filename, sizeBytes: data.length });
  }

  return { saved: saved.length, filenames: saved, skipped, isZip: true };
}

/**
 * Обрабатывает один update. Возвращает { ok, ... } — для тестов и логирования.
 */
export async function processUpdate(update, opts = {}) {
  const msg = update.message || update.edited_message;
  if (!msg) return { ok: true, skipped: 'no message' };

  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  if (!isAllowed(userId)) {
    await reply(chatId, '⛔ Доступ запрещён.');
    return { ok: false, reason: 'unauthorized', userId };
  }

  // Команды
  if (msg.text && msg.text.startsWith('/')) {
    await handleCommand(msg);
    return { ok: true, type: 'command' };
  }

  // Роутинг проекта
  const projectSlug = resolveProject(msg, chatId);
  if (!projectSlug) {
    await reply(chatId, '❌ Проект не выбран. Используй <code>/project &lt;slug&gt;</code> или <code>#slug</code> в подписи.');
    return { ok: false, reason: 'no project' };
  }

  // Photo
  if (msg.photo?.length) {
    try {
      const r = await handlePhoto(msg, projectSlug, opts);
      await reply(chatId, `✅ Фото → <b>${projectSlug}/inbox</b> (${Math.round(r.sizeBytes / 1024)} KB)`);
      return { ok: true, type: 'photo', ...r, project: projectSlug };
    } catch (e) {
      await reply(chatId, `❌ Ошибка: ${e.message}`);
      return { ok: false, reason: e.message };
    }
  }

  // Document (в т.ч. .zip)
  if (msg.document) {
    try {
      const r = await handleDocument(msg, projectSlug, opts);

      if (r.isZip) {
        const skippedNote = r.skipped?.length ? `\n⏭ Пропущено: ${r.skipped.length}` : '';
        await reply(chatId, `✅ ZIP → <b>${projectSlug}/inbox</b>\n📷 Извлечено: ${r.saved}${skippedNote}`);
      } else if (r.saved) {
        await reply(chatId, `✅ Документ → <b>${projectSlug}/inbox</b> (${Math.round(r.sizeBytes / 1024)} KB)`);
      } else {
        await reply(chatId, `⏭ Пропущено: ${r.reason || 'неизвестный формат'}`);
      }
      return { ok: true, type: 'document', ...r, project: projectSlug };
    } catch (e) {
      await reply(chatId, `❌ Ошибка: ${e.message}`);
      return { ok: false, reason: e.message };
    }
  }

  // Прочее — не поддерживаем
  await reply(chatId, '🤷 Понимаю только фото, документы и .zip');
  return { ok: true, type: 'other' };
}

/**
 * Основной цикл long-polling.
 * Возвращает Promise, который резолвится после stopIngestBot().
 */
export function startIngestBot(opts = {}) {
  const { onLog = console.log, fetchImpl, timeoutSec = 30 } = opts;
  let running = true;
  let offset = 0;
  let stopResolve = null;

  const stopPromise = new Promise((resolve) => { stopResolve = resolve; });

  (async () => {
    onLog('🤖 Telegram ingest bot started');
    while (running) {
      try {
        const updates = await getUpdates({ offset, timeoutSec, fetchImpl });
        for (const u of updates) {
          offset = u.update_id + 1;
          try {
            const r = await processUpdate(u, { fetchImpl });
            if (r.type === 'photo' || r.type === 'document') {
              onLog(`📥 ${r.project}: saved ${r.saved} (${r.type})`);
            }
          } catch (e) {
            onLog(`update ${u.update_id} failed: ${e.message}`);
          }
        }
      } catch (e) {
        onLog(`polling error: ${e.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    onLog('🤖 Telegram ingest bot stopped');
    if (stopResolve) stopResolve();
  })();

  return {
    stop: () => { running = false; return stopPromise; },
  };
}
