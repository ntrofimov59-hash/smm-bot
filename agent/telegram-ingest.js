// agent/telegram-ingest.js — Telegram-бот приёма фото.
//
// Что делает:
//   - Long-polling getUpdates
//   - Принимает: photo (сжатые), document (оригиналы), albums, .zip архивы
//   - Сохраняет в projects/<slug>/inbox/
//   - Whitelist по user_id (env TELEGRAM_INGEST_USERS)
//   - Команды: /start /help /project /projects /current
//   - Роутинг: #slug в caption → session → default
//   - Forwarded: помечает сообщение как пересылку + показывает источник
//   - Media group: альбом из N фото = один ответ (буферизация ~1.2 сек)
//
// Не делает: генерацию подписей, публикацию. Это работа scanner + scheduler.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import unzipper from 'unzipper';
import { getUpdates, sendMessage, downloadByFileId } from './telegram-api.js';
import { setProject, getProject, listProjects } from './telegram-sessions.js';

function getProjectsRoot() {
  return process.env.PROJECTS_ROOT
    ? path.resolve(process.env.PROJECTS_ROOT)
    : path.resolve(new URL('../projects/', import.meta.url).pathname);
}

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
  if (!list.length) return true;
  return list.includes(String(userId));
}

function uniqueFilename() {
  const ts = Date.now();
  const rand = crypto.randomBytes(4).toString('hex');
  return `${ts}-tg-${rand}`;
}

function ensureInbox(projectSlug) {
  const dir = path.join(getProjectsRoot(), projectSlug, 'inbox');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Извлекает информацию о пересылке.
 * Bot API 7.0+ использует forward_origin; legacy forward_from/forward_from_chat
 * сохранены для совместимости.
 *
 * @returns {{ source: string, type: string } | null}
 */
export function extractForwardInfo(msg) {
  if (!msg) return null;

  // --- Bot API 7.0+ ---
  if (msg.forward_origin) {
    const o = msg.forward_origin;
    if (o.type === 'user' && o.sender_user) {
      const u = o.sender_user;
      const name = u.username ? '@' + u.username : (u.first_name || 'user');
      return { source: name, type: 'user' };
    }
    if (o.type === 'hidden_user') {
      return { source: o.sender_user_name || 'hidden user', type: 'hidden' };
    }
    if (o.type === 'channel' && o.chat) {
      const name = o.chat.username ? '@' + o.chat.username : (o.chat.title || 'channel');
      return { source: name, type: 'channel' };
    }
    if (o.type === 'chat' && o.sender_chat) {
      const name = o.sender_chat.username ? '@' + o.sender_chat.username : (o.sender_chat.title || 'chat');
      return { source: name, type: 'chat' };
    }
  }

  // --- Legacy (Bot API ≤6.x) ---
  if (msg.forward_from) {
    const u = msg.forward_from;
    const name = u.username ? '@' + u.username : (u.first_name || 'user');
    return { source: name, type: 'user' };
  }
  if (msg.forward_from_chat) {
    const c = msg.forward_from_chat;
    const name = c.username ? '@' + c.username : (c.title || 'channel');
    return { source: name, type: 'channel' };
  }
  if (msg.forward_sender_name) {
    return { source: msg.forward_sender_name, type: 'hidden' };
  }

  return null;
}

/**
 * Роутинг: какой проект использовать для этого сообщения.
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
      '   (можно переслать из любого чата)',
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

async function handlePhoto(message, projectSlug, opts) {
  const photos = message.photo || [];
  if (!photos.length) return { saved: 0 };
  const largest = photos[photos.length - 1];

  const buf = await downloadByFileId(largest.file_id, opts);

  if (buf.length < 100) {
    throw new Error(`файл подозрительно маленький (${buf.length} байт) — вероятно не картинка`);
  }

  const dir = ensureInbox(projectSlug);
  const filename = uniqueFilename() + '.jpg';
  fs.writeFileSync(path.join(dir, filename), buf);
  return { saved: 1, filename, sizeBytes: buf.length };
}

async function handleDocument(message, projectSlug, opts) {
  const doc = message.document;
  if (!doc) return { saved: 0 };

  const fileName = doc.file_name || 'file';
  const ext = path.extname(fileName).toLowerCase();

  if (ext === '.zip' || doc.mime_type === 'application/zip') {
    return handleZip(message, projectSlug, opts);
  }

  if (UNSUPPORTED_EXT.has(ext)) {
    return { saved: 0, skipped: 1, reason: `unsupported format ${ext}` };
  }

  if (!IMAGE_EXT.has(ext)) {
    return { saved: 0, skipped: 1, reason: `not an image (${ext || doc.mime_type})` };
  }

  const buf = await downloadByFileId(doc.file_id, opts);

  if (buf.length < 100) {
    return { saved: 0, skipped: 1, reason: `файл слишком маленький (${buf.length} байт)` };
  }

  const dir = ensureInbox(projectSlug);
  const outExt = ext === '.jpeg' ? '.jpg' : ext;
  const filename = uniqueFilename() + outExt;
  fs.writeFileSync(path.join(dir, filename), buf);
  return { saved: 1, filename, sizeBytes: buf.length };
}

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
    if (entry.path.startsWith('__MACOSX/') || entry.path.endsWith('.DS_Store')) continue;

    const ext = path.extname(entry.path).toLowerCase();
    if (UNSUPPORTED_EXT.has(ext)) { skipped.push({ name: entry.path, reason: 'unsupported' }); continue; }
    if (!IMAGE_EXT.has(ext)) { skipped.push({ name: entry.path, reason: 'not image' }); continue; }

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

function formatForwardLine(forwardInfo) {
  if (!forwardInfo) return '';
  return `\n📩 переслано из <b>${forwardInfo.source}</b>`;
}

/**
 * Обрабатывает один update.
 */
export async function processUpdate(update, opts = {}) {
  const msg = update.message || update.edited_message;
  if (!msg) return { ok: true, skipped: 'no message' };

  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  if (!isAllowed(userId)) {
    const wl = getWhitelist().join(',') || '(empty — allow all)';
    console.warn(`[ingest] unauthorized: userId=${userId} chatId=${chatId} whitelist=${wl}`);
    await reply(chatId, `⛔ Доступ запрещён.\nТвой user_id: <code>${userId}</code>`);
    return { ok: false, reason: 'unauthorized', userId };
  }

  if (msg.text && msg.text.startsWith('/')) {
    await handleCommand(msg);
    return { ok: true, type: 'command' };
  }

  const projectSlug = resolveProject(msg, chatId);
  if (!projectSlug) {
    await reply(chatId, '❌ Проект не выбран. Используй <code>/project &lt;slug&gt;</code> или <code>#slug</code> в подписи.');
    return { ok: false, reason: 'no project' };
  }

  const forwardInfo = extractForwardInfo(msg);
  const forwardLine = formatForwardLine(forwardInfo);

  if (msg.photo?.length) {
    try {
      const r = await handlePhoto(msg, projectSlug, opts);
      await reply(chatId, `✅ Фото → <b>${projectSlug}/inbox</b> (${Math.round(r.sizeBytes / 1024)} KB)${forwardLine}`);
      return { ok: true, type: 'photo', ...r, project: projectSlug, forwarded: !!forwardInfo };
    } catch (e) {
      await reply(chatId, `❌ Ошибка: ${e.message}`);
      return { ok: false, reason: e.message };
    }
  }

  if (msg.document) {
    try {
      const r = await handleDocument(msg, projectSlug, opts);

      if (r.isZip) {
        const skippedNote = r.skipped?.length ? `\n⏭ Пропущено: ${r.skipped.length}` : '';
        await reply(chatId, `✅ ZIP → <b>${projectSlug}/inbox</b>\n📷 Извлечено: ${r.saved}${skippedNote}${forwardLine}`);
      } else if (r.saved) {
        await reply(chatId, `✅ Документ → <b>${projectSlug}/inbox</b> (${Math.round(r.sizeBytes / 1024)} KB)${forwardLine}`);
      } else {
        await reply(chatId, `⏭ Пропущено: ${r.reason || 'неизвестный формат'}`);
      }
      return { ok: true, type: 'document', ...r, project: projectSlug, forwarded: !!forwardInfo };
    } catch (e) {
      await reply(chatId, `❌ Ошибка: ${e.message}`);
      return { ok: false, reason: e.message };
    }
  }

  await reply(chatId, '🤷 Понимаю только фото, документы и .zip');
  return { ok: true, type: 'other' };
}

/**
 * Обрабатывает альбом (media_group).
 * Принимает массив updates, каждый из которых — фото или document.
 * Скачивает всё в inbox, шлёт ОДИН ответ.
 */
export async function processMediaGroup(updates, opts = {}) {
  if (!updates.length) return { ok: true, count: 0 };

  const firstMsg = updates[0].message || updates[0].edited_message;
  const chatId = firstMsg.chat.id;
  const userId = firstMsg.from?.id;

  if (!isAllowed(userId)) {
    await reply(chatId, '⛔ Доступ запрещён.');
    return { ok: false, reason: 'unauthorized' };
  }

  const projectSlug = resolveProject(firstMsg, chatId);
  if (!projectSlug) {
    await reply(chatId, '❌ Проект не выбран. Используй <code>/project &lt;slug&gt;</code>.');
    return { ok: false, reason: 'no project' };
  }

  const forwardInfo = extractForwardInfo(firstMsg);
  const forwardLine = formatForwardLine(forwardInfo);

  let totalSaved = 0;
  let totalBytes = 0;
  const errors = [];

  for (const u of updates) {
    const msg = u.message || u.edited_message;
    try {
      if (msg.photo?.length) {
        const r = await handlePhoto(msg, projectSlug, opts);
        totalSaved += r.saved;
        totalBytes += r.sizeBytes || 0;
      } else if (msg.document) {
        const r = await handleDocument(msg, projectSlug, opts);
        if (r.isZip) {
          totalSaved += r.saved;
        } else if (r.saved) {
          totalSaved += r.saved;
          totalBytes += r.sizeBytes || 0;
        }
      }
    } catch (e) {
      errors.push(e.message);
    }
  }

  const sizeInfo = totalBytes > 0 ? ` (${Math.round(totalBytes / 1024)} KB)` : '';
  const errInfo = errors.length ? `\n⚠️ Ошибок: ${errors.length}` : '';
  await reply(chatId, `✅ Альбом (${totalSaved} файлов) → <b>${projectSlug}/inbox</b>${sizeInfo}${errInfo}${forwardLine}`);

  return { ok: true, type: 'media_group', saved: totalSaved, project: projectSlug, forwarded: !!forwardInfo };
}

/**
 * Основной цикл long-polling.
 */
export function startIngestBot(opts = {}) {
  const {
    onLog = console.log,
    fetchImpl,
    timeoutSec = 30,
    mediaGroupWaitMs = 1200,
  } = opts;

  let running = true;
  let offset = 0;
  let stopResolve = null;
  const mediaGroups = new Map();

  const stopPromise = new Promise((resolve) => { stopResolve = resolve; });

  const flushMediaGroup = async (groupId) => {
    const entry = mediaGroups.get(groupId);
    if (!entry) return;
    mediaGroups.delete(groupId);
    if (entry.timer) clearTimeout(entry.timer);

    try {
      const r = await processMediaGroup(entry.messages, { fetchImpl });
      if (r.ok && r.saved) {
        onLog(`📥 ${r.project}: media_group saved ${r.saved} files`);
      }
    } catch (e) {
      onLog(`media_group flush failed: ${e.message}`);
    }
  };

  (async () => {
    onLog('🤖 Telegram ingest bot started');
    while (running) {
      try {
        const updates = await getUpdates({ offset, timeoutSec, fetchImpl });
        for (const u of updates) {
          offset = u.update_id + 1;
          const msg = u.message || u.edited_message;

          // Буферизация альбомов
          if (msg?.media_group_id) {
            const gid = msg.media_group_id;
            if (!mediaGroups.has(gid)) {
              mediaGroups.set(gid, { messages: [], timer: null });
            }
            const entry = mediaGroups.get(gid);
            entry.messages.push(u);
            if (entry.timer) clearTimeout(entry.timer);
            entry.timer = setTimeout(() => flushMediaGroup(gid), mediaGroupWaitMs);
            continue;
          }

          // Обычное сообщение
          try {
            const r = await processUpdate(u, { fetchImpl });
            if ((r.type === 'photo' || r.type === 'document') && r.saved) {
              onLog(`📥 ${r.project}: saved ${r.saved} (${r.type}${r.forwarded ? ', forwarded' : ''})`);
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
    // Отменяем висящие таймеры буферов
    for (const entry of mediaGroups.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    mediaGroups.clear();
    onLog('🤖 Telegram ingest bot stopped');
    if (stopResolve) stopResolve();
  })();

  return {
    stop: () => { running = false; return stopPromise; },
  };
}
