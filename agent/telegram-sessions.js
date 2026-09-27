// agent/telegram-sessions.js — state: какой проект активен для каждого chat_id
import fs from 'fs';
import path from 'path';

const DEFAULT_DATA_DIR = path.resolve(new URL('./data/', import.meta.url).pathname);

function getSessionsFile() {
  const dir = process.env.SMM_DATA_DIR || DEFAULT_DATA_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'telegram-sessions.json');
}

function load() {
  try {
    const file = getSessionsFile();
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  return {};
}

function save(data) {
  try {
    fs.writeFileSync(getSessionsFile(), JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('telegram-sessions: save failed:', e.message);
  }
}

/**
 * Установить активный проект для чата.
 */
export function setProject(chatId, projectSlug) {
  const data = load();
  data[String(chatId)] = { projectSlug, updatedAt: new Date().toISOString() };
  save(data);
}

/**
 * Получить активный проект.
 */
export function getProject(chatId) {
  const data = load();
  return data[String(chatId)]?.projectSlug || null;
}

export function clearProject(chatId) {
  const data = load();
  delete data[String(chatId)];
  save(data);
}

/**
 * Список проектов на диске (сканирует projects/).
 */
export function listProjects() {
  const root = path.resolve(new URL('../projects/', import.meta.url).pathname);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(d => {
    try {
      if (!fs.statSync(path.join(root, d)).isDirectory()) return false;
      return fs.existsSync(path.join(root, d, 'project.json'));
    } catch { return false; }
  });
}
