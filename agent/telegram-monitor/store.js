// agent/telegram-monitor/store.js — конфиг каналов и база найденных лидов.

import fs from 'fs';
import path from 'path';

function dir(projectPath) {
  return path.join(projectPath, 'telegram-monitor');
}

function channelsFile(projectPath) {
  return path.join(dir(projectPath), 'channels.json');
}

function keywordsFile(projectPath) {
  return path.join(dir(projectPath), 'keywords.json');
}

function leadsFile(projectPath) {
  return path.join(dir(projectPath), 'leads.json');
}

const DEFAULT_KEYWORDS = {
  ru: [
    'ищу фотографа', 'нужен фотограф', 'ищу ведущего', 'нужен ведущий',
    'ищу декоратора', 'нужен декоратор', 'ищу кейтеринг', 'нужен кейтеринг',
    'ищу площадку', 'нужна площадка', 'ищу шатёр', 'нужен шатёр', 'аренда шатра',
    'ищу организатора', 'нужен организатор', 'ищу event-агентство',
    'кто делает свадьбы', 'кто организует корпоратив',
    'подскажите фотографа', 'посоветуйте ведущего', 'ищу DJ', 'нужен DJ',
  ],
  en: [
    'looking for photographer', 'need a photographer', 'looking for venue',
    'need a venue', 'looking for caterer', 'need catering', 'looking for decorator',
    'need an event planner', 'need wedding planner', 'looking for a DJ',
    'any recommendations for photographer', 'who does weddings here',
  ],
  hy: [
    'փնտրում եմ լուսանկարիչ', 'լուսանկարիչ եմ փնտրում', 'փնտրում եմ վայր',
    'փնտրում եմ կազմակերպիչ', 'փնտրում եմ քեյթերինգ',
  ],
};

export function loadChannels(projectPath) {
  const f = channelsFile(projectPath);
  if (!fs.existsSync(f)) return { version: 1, channels: [] };
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    throw new Error(`telegram-monitor/store: невалидный JSON ${f}: ${e.message}`, { cause: e });
  }
}

export function saveChannels(projectPath, data) {
  const d = dir(projectPath);
  fs.mkdirSync(d, { recursive: true });
  const f = channelsFile(projectPath);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
}

export function loadKeywords(projectPath) {
  const f = keywordsFile(projectPath);
  if (!fs.existsSync(f)) {
    // создать с дефолтными
    const d = dir(projectPath);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(DEFAULT_KEYWORDS, null, 2));
    return DEFAULT_KEYWORDS;
  }
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    throw new Error(`telegram-monitor/store: невалидный JSON ${f}: ${e.message}`, { cause: e });
  }
}

export function loadLeads(projectPath) {
  const f = leadsFile(projectPath);
  if (!fs.existsSync(f)) return { version: 1, leads: [] };
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    throw new Error(`telegram-monitor/store: невалидный JSON ${f}: ${e.message}`, { cause: e });
  }
}

export function saveLeads(projectPath, data) {
  const d = dir(projectPath);
  fs.mkdirSync(d, { recursive: true });
  const f = leadsFile(projectPath);
  const tmp = f + '.tmp';
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
}

export function addChannel(projectPath, channel) {
  const data = loadChannels(projectPath);
  const id = channel.id || channel.username || channel.title;

  if (!id) throw new Error('telegram-monitor: нужно id | username | title');

  // Дедуп: совпадает username ИЛИ (оба id не null и равны)
  const exists = data.channels.find(c => {
    if (channel.username && c.username &&
        String(c.username).toLowerCase() === String(channel.username).toLowerCase()) {
      return true;
    }
    if (channel.id != null && c.id != null && String(c.id) === String(channel.id)) {
      return true;
    }
    return false;
  });
  if (exists) throw new Error(`канал уже в списке: ${exists.title || exists.username}`);

  data.channels.push({
    id: channel.id || null,
    username: channel.username || null,
    title: channel.title || null,
    city: channel.city || null,
    segment: channel.segment || 'other',
    language: channel.language || 'ru',
    enabled: channel.enabled !== false,
    addedAt: new Date().toISOString(),
  });
  saveChannels(projectPath, data);
  return data.channels[data.channels.length - 1];
}

export function addLead(projectPath, lead) {
  const data = loadLeads(projectPath);

  // дедуп по messageId + chatId
  const dup = data.leads.find(l => l.chatId === lead.chatId && l.messageId === lead.messageId);
  if (dup) return null;

  data.leads.push(lead);
  saveLeads(projectPath, data);
  return lead;
}

export function listLeads(projectPath, { since = null, limit = null } = {}) {
  const data = loadLeads(projectPath);
  let leads = data.leads;
  if (since) {
    const ts = new Date(since).getTime();
    leads = leads.filter(l => new Date(l.foundAt).getTime() >= ts);
  }
  leads = leads.slice().reverse();
  return limit ? leads.slice(0, limit) : leads;
}

export { DEFAULT_KEYWORDS };
