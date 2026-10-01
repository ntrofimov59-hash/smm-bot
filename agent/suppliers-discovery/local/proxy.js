// agent/suppliers-discovery/local/proxy.js — настройка прокси для парсинга.
// Если RESIDENTIAL_PROXY_URL задан в .env — используем для HTTP-запросов.
// Формат: http://user:pass@host:port

import { ProxyAgent } from 'undici';

let _dispatcher = null;

export function getDispatcher() {
  const url = process.env.RESIDENTIAL_PROXY_URL;
  if (!url) return null;
  if (!_dispatcher) {
    try {
      _dispatcher = new ProxyAgent(url);
    } catch (e) {
      console.error('proxy: не удалось создать dispatcher:', e.message);
    }
  }
  return _dispatcher;
}

export function hasProxy() {
  return !!process.env.RESIDENTIAL_PROXY_URL;
}

/**
 * fetch с прокси (если задан). Иначе обычный fetch.
 */
export async function proxiedFetch(url, opts = {}) {
  const dispatcher = getDispatcher();
  if (dispatcher) {
    return fetch(url, { ...opts, dispatcher });
  }
  return fetch(url, opts);
}
