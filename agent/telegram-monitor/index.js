// agent/telegram-monitor/index.js — Telegram-мониторинг через userbot (MTProto).
// Только ЧТЕНИЕ. Ничего не отправляет от имени userbot.
//
// Как это работает:
//   1. Инициализация TelegramClient с session-строкой из .env
//   2. Подписка на события NewMessage из каналов/групп из channels.json
//   3. Фильтр по ключевым словам или intent
//   4. Сохранение в leads.json + уведомление в Telegram-бот аналитики
//
// Запуск: node agent/telegram-monitor-cli.js run <project>

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { loadChannels, loadKeywords, addLead } from './store.js';
import { matchKeywords, detectIntent } from './matcher.js';

const API_ID = Number(process.env.TELEGRAM_MONITOR_API_ID);
const API_HASH = process.env.TELEGRAM_MONITOR_API_HASH;
const SESSION = process.env.TELEGRAM_MONITOR_SESSION;

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

async function resolveChannels(client, channels) {
  // В Telegram MTProto нет простого способа найти канал по username в новой версии.
  // Используем getEntity по username или id.
  const resolved = [];
  for (const ch of channels) {
    if (!ch.enabled) continue;
    try {
      const key = ch.username ? `@${ch.username}` : ch.id;
      const entity = await client.getEntity(key);
      resolved.push({ ...ch, entity });
    } catch (e) {
      console.error(`⚠️  не удалось разрешить ${ch.username || ch.id}: ${e.message}`);
    }
  }
  return resolved;
}

function extractMessageText(msg) {
  return (msg.message || '').trim();
}

function buildLead(msg, chat, match) {
  const text = extractMessageText(msg);
  const sender = msg.sender?.username ? `@${msg.sender.username}` : (msg.sender?.firstName || null);
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

export async function runMonitor({ projectPath, onLead, onLog = console.error }) {
  const channels = loadChannels(projectPath).channels;
  const keywords = loadKeywords(projectPath);

  if (!channels.length) {
    throw new Error('telegram-monitor: channels.json пуст. Добавь канал через cli.');
  }

  const client = await createClient();
  const me = await client.getMe();
  onLog(`✅ подключено как ${me.username || me.firstName} (${me.id})`);

  const resolved = await resolveChannels(client, channels);
  onLog(`📡 активно каналов: ${resolved.length}/${channels.length}`);

  const resolvedByChatId = new Map();
  for (const ch of resolved) {
    const id = String(ch.entity.id);
    resolvedByChatId.set(id, ch);
    onLog(`   • ${ch.title || ch.username} (${ch.city || '—'})`);
  }

  const handler = async (event) => {
    try {
      const msg = event.message;
      if (!msg || !msg.message) return;

      const chatId = String(msg.chatId?.toString() || msg.peerId?.toString() || '');
      const ch = resolvedByChatId.get(chatId);
      if (!ch) return;

      const text = extractMessageText(msg);
      if (!text || text.length < 10) return;

      // 1. Keyword match
      const kwHits = matchKeywords(text, keywords);
      // 2. Intent detection
      const intent = detectIntent(text);

      if (!kwHits.length && !intent) return;

      const chat = await msg.getChat();
      const lead = buildLead(msg, chat, {
        keywords: kwHits,
        intent: intent,
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

  // Подписка на новые сообщения в конкретных чатах
  const chatIds = resolved.map(ch => ch.entity.id);
  client.addEventHandler(handler, new NewMessage({ chats: chatIds }));

  return { client, resolvedCount: resolved.length };
}

export async function stopMonitor(client) {
  if (client) await client.disconnect();
}
