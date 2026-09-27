// agent/telegram-api.js — тонкая обёртка над Telegram Bot API.
// Никакой бизнес-логики, только HTTP-вызовы. Легко мокается в тестах.

const API_BASE = 'https://api.telegram.org';

function getToken() {
  return process.env.TELEGRAM_INGEST_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
}

function apiUrl(method) {
  const t = getToken();
  if (!t) throw new Error('telegram-api: TELEGRAM_INGEST_BOT_TOKEN (или TELEGRAM_BOT_TOKEN) не задан');
  return `${API_BASE}/bot${t}/${method}`;
}

async function callApi(method, body, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(apiUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`telegram-api ${method}: ${data.description || 'unknown error'}`);
  }
  return data.result;
}

/**
 * Long-polling getUpdates.
 * @param {{ offset?: number, timeoutSec?: number, fetchImpl?: Function }} opts
 * @returns {Promise<Array>} updates
 */
export async function getUpdates({ offset = 0, timeoutSec = 30, fetchImpl } = {}) {
  try {
    return await callApi('getUpdates', {
      offset,
      timeout: timeoutSec,
      allowed_updates: ['message', 'edited_message'],
    }, { fetchImpl });
  } catch (e) {
    // network timeout — не ошибка, просто нет новых сообщений
    if (/timeout|aborted/i.test(e.message)) return [];
    throw e;
  }
}

/**
 * Отправка текстового сообщения.
 */
export async function sendMessage(chatId, text, { parseMode = 'HTML', fetchImpl } = {}) {
  return callApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  }, { fetchImpl });
}

/**
 * Получить метаданные файла (file_path для скачивания).
 */
export async function getFile(fileId, { fetchImpl } = {}) {
  return callApi('getFile', { file_id: fileId }, { fetchImpl });
}

/**
 * Скачать файл по file_path, вернуть Buffer.
 * file_path приходит из getFile.
 */
export async function downloadFile(filePath, { fetchImpl = fetch } = {}) {
  const t = getToken();
  if (!t) throw new Error('telegram-api: token не задан');
  const url = `${API_BASE}/file/bot${t}/${filePath}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`telegram-api downloadFile: HTTP ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Хелпер: file_id → Buffer одним вызовом.
 */
export async function downloadByFileId(fileId, opts = {}) {
  const { fetchImpl } = opts;
  const file = await getFile(fileId, { fetchImpl });
  return downloadFile(file.file_path, { fetchImpl });
}
