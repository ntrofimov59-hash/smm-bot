// agent/telegram-monitor/discovery-store.js — хранилище найденных кандидатов.
// Файл: projects/<slug>/telegram-monitor/candidates.json

import fs from 'fs';
import path from 'path';

function dir(projectPath) { return path.join(projectPath, 'telegram-monitor'); }

function file(projectPath) { return path.join(dir(projectPath), 'candidates.json'); }

export function loadCandidates(projectPath) {
  const f = file(projectPath);
  if (!fs.existsSync(f)) return { version: 1, candidates: [] };
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { throw new Error(`candidates.json невалиден: ${e.message}`, { cause: e }); }
}

export function saveCandidates(projectPath, data) {
  const d = dir(projectPath);
  fs.mkdirSync(d, { recursive: true });
  const f = file(projectPath);
  const tmp = f + '.tmp';
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
}

/**
 * Добавляет новые кандидаты. Дедуп по username.
 * Возвращает {added, dup}.
 */
export function addMany(projectPath, items) {
  const data = loadCandidates(projectPath);
  const seen = new Set(data.candidates.map(c => c.username.toLowerCase()));

  let added = 0, dup = 0;
  for (const it of items) {
    const u = String(it.username || '').toLowerCase();
    if (!u) continue;
    if (seen.has(u)) { dup++; continue; }
    seen.add(u);
    data.candidates.push({
      username: it.username,
      title: it.title || null,
      subscribers: it.subscribers || null,
      description: it.description || null,
      source: it.source || 'unknown',
      query: it.query || null,
      context: it.context || null,
      discoveredAt: it.discoveredAt || new Date().toISOString(),
      status: 'pending',
      reviewedAt: null,
      reviewData: null,
      rejectReason: null,
    });
    added++;
  }
  saveCandidates(projectPath, data);
  return { added, dup };
}

export function listCandidates(projectPath, { status = null } = {}) {
  const data = loadCandidates(projectPath);
  return status
    ? data.candidates.filter(c => c.status === status)
    : data.candidates;
}

export function updateCandidate(projectPath, username, patch) {
  const data = loadCandidates(projectPath);
  const u = String(username).replace(/^@/, '').toLowerCase();
  const c = data.candidates.find(x => x.username.toLowerCase() === u);
  if (!c) return null;
  Object.assign(c, patch);
  saveCandidates(projectPath, data);
  return c;
}

export function getCandidate(projectPath, username) {
  const data = loadCandidates(projectPath);
  const u = String(username).replace(/^@/, '').toLowerCase();
  return data.candidates.find(x => x.username.toLowerCase() === u) || null;
}
