// agent/telegram-monitor/index.js — userbot: только чтение.
// Резолв: dialogs → numeric id → (опционально) getEntity без flood.
// Refresh каждые TELEGRAM_MONITOR_REFRESH_MIN минут (дефолт 10) —
// подхватит новые join и изменения channels.json без pm2 restart.

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { loadChannels, saveChannels, loadKeywords, addLead } from './store.js';
import { matchKeywords, detectIntent } from './matcher.js';

const API_ID = Number(process.env.TELEGRAM_MONITOR_API_ID);
const API_HASH = process.env.TELEGRAM_MONITOR_API_HASH;
const SESSION = process.env.TELEGRAM_MONITOR_SESSION;

/** минут между refresh dialogs + channels.json */
const REFRESH_MIN = Math.max(
  3,
  Number(process.env.TELEGRAM_MONITOR_REFRESH_MIN || 10) || 10
);

export function hasCredentials() {
  return API_ID && API_HASH && SESSION;
}

export async function createClient() {
  if (!hasCredentials()) {
    throw new Error('telegram-monitor: не заданы TELEGRAM_MONITOR_API_ID/HASH/SESSION в .env');
  }
  const client = new TelegramClient(new StringSession(SESSION), API_ID, API_HASH, {
    connectionRetries: 5,
  });
  await client.connect();
  return client;
}

/**
 * @returns {{ resolved: Array, floodLeft: number|null, dialogCount: number }}
 */
async function resolveChannels(client, channels, { projectPath = null, onLog = console.error, allowResolveUsername = true } = {}) {
  const enabled = channels.filter((c) => c.enabled !== false);
  const resolved = [];
  const byUsername = new Map();

  let dialogCount = 0;
  try {
    const dialogs = await client.getDialogs({ limit: 500 });
    dialogCount = dialogs.length;
    for (const d of dialogs) {
      const e = d.entity;
      if (!e) continue;
      const u = (e.username || '').toLowerCase();
      if (u) byUsername.set(u, e);
    }
  } catch (e) {
    onLog(`⚠️  getDialogs: ${e.message}`);
  }

  let floodLeft = null;

  for (const ch of enabled) {
    const uname = (ch.username || '').replace(/^@/, '').toLowerCase();
    let entity = null;

    // 1) numeric id
    if (ch.id != null && /^-?\d+$/.test(String(ch.id))) {
      try {
        entity = await client.getEntity(Number(ch.id));
      } catch {
        /* fallback */
      }
    }

    // 2) dialogs by username
    if (!entity && uname && byUsername.has(uname)) {
      entity = byUsername.get(uname);
    }

    // 3) ResolveUsername — только если разрешено и нет flood
    if (!entity && uname && allowResolveUsername && floodLeft == null) {
      try {
        entity = await client.getEntity('@' + uname);
      } catch (e) {
        const msg = String(e.message || e);
        const m = msg.match(/wait of (\d+) seconds/i);
        if (m) {
          floodLeft = Number(m[1]);
          onLog(`⏸ FLOOD_WAIT ${floodLeft}s — refresh только dialogs/id`);
        } else {
          onLog(`⚠️  ${ch.username || ch.id}: ${msg.slice(0, 100)}`);
        }
      }
    }

    if (entity) {
      resolved.push({ ...ch, entity });
      if (projectPath && entity.id != null) {
        try {
          const data = loadChannels(projectPath);
          const row = data.channels.find(
            (c) =>
              (uname && c.username && c.username.toLowerCase() === uname) ||
              (ch.id != null && String(c.id) === String(ch.id))
          );
          if (row) {
            row.id = String(entity.id);
            if (entity.username) row.username = entity.username;
            if (entity.title) row.title = entity.title;
            saveChannels(projectPath, data);
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  return { resolved, floodLeft, dialogCount };
}

function extractMessageText(msg) {
  return (msg.message || '').trim();
}

function buildLead(msg, chat, match) {
  const text = extractMessageText(msg);
  const sender = msg.sender?.username
    ? `@${msg.sender.username}`
    : msg.sender?.firstName || null;
  const chatUsername = chat.username ? `@${chat.username}` : null;

  return {
    chatId: String(chat.id),
    chatTitle: chat.title || null,
    chatUsername,
    messageId: msg.id,
    text,
    sender,
    senderId: msg.senderId ? String(msg.senderId) : null,
    foundAt: new Date().toISOString(),
    match,
    messageUrl: chatUsername ? `https://t.me/${chat.username}/${msg.id}` : null,
    status: 'new',
  };
}

function applyResolved(resolvedByChatId, resolved, onLog, { quiet = false } = {}) {
  const prev = new Set(resolvedByChatId.keys());
  const next = new Map();
  for (const ch of resolved) {
    const id = String(ch.entity.id);
    next.set(id, ch);
  }
  // mutate in place so handler всегда видит актуальный Map
  for (const k of prev) {
    if (!next.has(k)) resolvedByChatId.delete(k);
  }
  for (const [k, v] of next) {
    const isNew = !prev.has(k);
    resolvedByChatId.set(k, v);
    if (isNew && !quiet) {
      onLog(`   ➕ ${v.title || v.username} (${v.city || '—'})`);
    }
  }
  return { active: resolvedByChatId.size, added: [...next.keys()].filter((k) => !prev.has(k)).length };
}

export async function runMonitor({ projectPath, onLead, onLog = console.error }) {
  let channels = loadChannels(projectPath).channels;
  const keywords = loadKeywords(projectPath);

  if (!channels.length) {
    throw new Error('telegram-monitor: channels.json пуст. Добавь канал через cli.');
  }

  const client = await createClient();
  const me = await client.getMe();
  onLog(`✅ подключено как ${me.username || me.firstName} (${me.id})`);

  // При старте: если flood — allowResolveUsername=false после первой ошибки внутри resolve
  let allowResolveUsername = true;
  const first = await resolveChannels(client, channels, {
    projectPath,
    onLog,
    allowResolveUsername,
  });
  if (first.floodLeft != null) allowResolveUsername = false;

  onLog(`📂 dialogs: ${first.dialogCount}`);
  onLog(`📡 активно каналов: ${first.resolved.length}/${channels.filter((c) => c.enabled !== false).length}`);

  const resolvedByChatId = new Map();
  applyResolved(resolvedByChatId, first.resolved, onLog, { quiet: false });
  for (const ch of first.resolved) {
    onLog(`   • ${ch.title || ch.username} (${ch.city || '—'})`);
  }

  const state = {
    keywords,
    allowResolveUsername,
    refreshing: false,
  };

  const handler = async (event) => {
    try {
      const msg = event.message;
      if (!msg || !msg.message) return;

      // chat id: несколько вариантов gramJS
      let chatId = '';
      if (msg.chatId != null) chatId = String(msg.chatId);
      else if (msg.peerId?.channelId != null) chatId = String(msg.peerId.channelId);
      else if (msg.peerId?.chatId != null) chatId = String(msg.peerId.chatId);

      // иногда id приходит с минусом / без — пробуем оба
      let ch = resolvedByChatId.get(chatId);
      if (!ch && chatId) {
        ch = resolvedByChatId.get(`-${chatId}`) || resolvedByChatId.get(chatId.replace(/^-/, ''));
      }
      if (!ch) return;

      const text = extractMessageText(msg);
      if (!text || text.length < 10) return;

      const kwHits = matchKeywords(text, state.keywords);
      const intent = detectIntent(text);
      if (!kwHits.length && !intent) return;

      const chat = await msg.getChat();
      const lead = buildLead(msg, chat, {
        keywords: kwHits,
        intent,
        city: ch.city,
        segment: ch.segment,
      });

      const saved = addLead(projectPath, lead);
      if (saved) {
        onLog(`🎯 [${ch.city || '—'}] ${text.slice(0, 90)}...`);
        if (onLead) await onLead(saved, ch);
      }
    } catch (e) {
      onLog(`⚠️  handler error: ${e.message}`);
    }
  };

  // Без фильтра chats — иначе после join пришлось бы пересоздавать handler.
  // Фильтр: только id из resolvedByChatId (обновляется на refresh).
  client.addEventHandler(handler, new NewMessage({}));

  async function refresh() {
    if (state.refreshing) return;
    state.refreshing = true;
    try {
      channels = loadChannels(projectPath).channels;
      state.keywords = loadKeywords(projectPath);

      const result = await resolveChannels(client, channels, {
        projectPath,
        onLog: (m) => {
          // на refresh не спамим каждой flood-строкой
          if (/FLOOD_WAIT/i.test(m)) onLog(m);
          else if (/getDialogs/i.test(m)) onLog(m);
        },
        allowResolveUsername: state.allowResolveUsername,
      });
      if (result.floodLeft != null) state.allowResolveUsername = false;

      const { active, added } = applyResolved(resolvedByChatId, result.resolved, onLog);
      const enabledN = channels.filter((c) => c.enabled !== false).length;
      if (added > 0) {
        onLog(`🔄 refresh: +${added} канал(ов), активно ${active}/${enabledN} (dialogs ${result.dialogCount})`);
      } else {
        onLog(`🔄 refresh: активно ${active}/${enabledN} (dialogs ${result.dialogCount})`);
      }
    } catch (e) {
      onLog(`⚠️  refresh error: ${e.message}`);
    } finally {
      state.refreshing = false;
    }
  }

  const refreshMs = REFRESH_MIN * 60 * 1000;
  onLog(`⏱  auto-refresh каждые ${REFRESH_MIN} мин (TELEGRAM_MONITOR_REFRESH_MIN)`);
  const timer = setInterval(refresh, refreshMs);
  // не держим процесс только из‑за timer unref — PM2 и так живой
  if (timer.unref) timer.unref();

  return {
    client,
    resolvedCount: resolvedByChatId.size,
    refresh,
    stopRefresh: () => clearInterval(timer),
  };
}

export async function stopMonitor(client) {
  if (client) await client.disconnect();
}
