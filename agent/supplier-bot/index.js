// agent/supplier-bot/index.js — Telegram-бот поиска поставщиков.
// Только приём запросов от тебя + ответ из базы. Ничего наружу не пишет.
//
// Токен: SUPPLIER_BOT_TOKEN в .env (создай бота у @BotFather)
// Whitelist: SUPPLIER_BOT_USERS (user_id, через запятую). Пусто = разрешить всем (dev).

import { parseQuery } from './parser.js';
import { matchSuppliers } from './matcher.js';
import { formatReply } from './formatter.js';

const TELEGRAM_API = 'https://api.telegram.org';

function getToken() {
  return process.env.SUPPLIER_BOT_TOKEN || null;
}

function getWhitelist() {
  return (process.env.SUPPLIER_BOT_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
}

function isAllowed(userId) {
  const wl = getWhitelist();
  if (!wl.length) return true;
  return wl.includes(String(userId));
}

async function tgApi(method, body) {
  const token = getToken();
  if (!token) throw new Error('SUPPLIER_BOT_TOKEN не задан');
  const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(chatId, text, opts = {}) {
  return tgApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...opts,
  });
}

async function getUpdates(offset = 0, timeoutSec = 25) {
  const token = getToken();
  if (!token) throw new Error('SUPPLIER_BOT_TOKEN не задан');
  const url = `${TELEGRAM_API}/bot${token}/getUpdates?offset=${offset}&timeout=${timeoutSec}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.result || [];
}

const HELP = `🔍 <b>Поиск поставщиков</b>

Напиши, кого ищешь, и я найду в базе:

• <i>нужен фотограф в Ереване</i>
• <i>кейтеринг тбилиси на 100 гостей</i>
• <i>диджей на бали</i>
• <i>ведущий ереван</i>
• <i>площадка прага</i>

Я отвечу списком с контактами и ссылками.

<b>Категории:</b> venues, photographers, videographers, caterers, decorators, florists, djs, hosts, musicians, makeup, transfer, entertainers, planners, rental, other

/help — эта справка`;

export async function handleMessage(msg, projectPath) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = (msg.text || '').trim();

  if (!isAllowed(userId)) {
    await sendMessage(chatId, `⛔ Доступ закрыт. Твой user_id: <code>${userId}</code>`);
    return;
  }

  if (text.startsWith('/')) {
    const cmd = text.split(/\s+/)[0].replace(/@\S+$/, '').toLowerCase();
    if (cmd === '/start' || cmd === '/help') {
      await sendMessage(chatId, HELP);
      return;
    }
    await sendMessage(chatId, 'Команда не понята. /help');
    return;
  }

  const query = parseQuery(text);
  const result = matchSuppliers(projectPath, query);
  const reply = formatReply(query, result);
  await sendMessage(chatId, reply);
}

export function startSupplierBot({ projectPath, onLog = console.log }) {
  let running = true;
  let offset = 0;
  let stopResolve = null;
  const stopPromise = new Promise(res => { stopResolve = res; });

  (async () => {
    onLog('🤖 Supplier bot started');
    while (running) {
      try {
        const updates = await getUpdates(offset);
        for (const u of updates) {
          offset = u.update_id + 1;
          const msg = u.message || u.edited_message;
          if (!msg || !msg.text) continue;
          try {
            await handleMessage(msg, projectPath);
          } catch (e) {
            onLog(`handle error: ${e.message}`);
          }
        }
      } catch (e) {
        onLog(`polling error: ${e.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    onLog('🤖 Supplier bot stopped');
    if (stopResolve) stopResolve();
  })();

  return {
    stop: () => { running = false; return stopPromise; },
  };
}
