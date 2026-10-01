// agent/suppliers-import.js — импорт кандидатов из outreach/telegram-monitor
// в базу поставщиков.
//
// Использование:
//   node agent/suppliers-import.js from-outreach <project> [--min-score 50]
//   node agent/suppliers-import.js from-monitor <project> [--min-subs 500]

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import * as suppliers from './suppliers/store.js';
import { classifyText } from './suppliers-discovery/classify.js';

function projectPath(slug) {
  const root = process.env.PROJECTS_ROOT
    ? path.resolve(process.env.PROJECTS_ROOT)
    : path.resolve(new URL('../projects/', import.meta.url).pathname);
  return path.join(root, slug);
}

function guessCategory(c) {
  const text = `${c.name || ''} ${c.title || ''} ${c.notes || ''} ${c.context || ''} ${c.description || ''}`;
  return classifyText(text, 'other');
}

function loadJson(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`⚠️  ${file}: ${e.message}`); return null; }
}

async function importOutreach(p, { minScore = 50 } = {}) {
  const file = path.join(p, 'outreach', 'candidates.json');
  const data = loadJson(file);
  if (!data) { console.error('❌ Нет outreach/candidates.json'); return; }

  const candidates = (data.candidates || []).filter(c => {
    if (c.status === 'do_not_contact' || c.status === 'rejected') return false;
    return (c.score || 0) >= minScore;
  });

  console.log(`📥 Outreach: ${candidates.length} кандидатов со score >= ${minScore}`);
  let added = 0, dup = 0, err = 0;

  for (const c of candidates) {
    const category = guessCategory(c);
    try {
      suppliers.addSupplier(p, {
        category,
        name: c.name || c.username || 'unknown',
        city: c.city || null,
        phone: c.phone || null,
        email: c.email || null,
        instagram: c.instagram || c.username || null,
        telegram: c.telegram || null,
        website: c.website || null,
        notes: c.notes || null,
        tags: [],
        verified: false,
        source: 'outreach',
        sourceUrl: c.sourceUrl || null,
      });
      added++;
    } catch (e) {
      if (e.message.includes('Дубликат')) dup++;
      else { err++; console.error(`  ❌ ${c.name}: ${e.message}`); }
    }
  }
  console.log(`✅ +${added}, дубликатов: ${dup}, ошибок: ${err}`);
}

async function importMonitor(p, { minSubs = 500 } = {}) {
  const file = path.join(p, 'telegram-monitor', 'candidates.json');
  const data = loadJson(file);
  if (!data) { console.error('❌ Нет telegram-monitor/candidates.json'); return; }

  const candidates = (data.candidates || []).filter(c => {
    if (c.status !== 'verified' && c.status !== 'notified') return false;
    if (typeof c.subscribers !== 'number') return false;
    return c.subscribers >= minSubs;
  });

  console.log(`📥 Monitor: ${candidates.length} каналов с subs >= ${minSubs}`);
  let added = 0, dup = 0, err = 0;

  for (const c of candidates) {
    const category = guessCategory({
      name: c.title,
      title: c.title,
      context: c.description,
      segment: c.segment,
    });
    try {
      suppliers.addSupplier(p, {
        category,
        name: c.title || c.username,
        city: c.city || null,
        telegram: c.username,
        notes: c.description || null,
        tags: [],
        verified: false,
        source: 'telegram_monitor',
        sourceUrl: `https://t.me/${c.username}`,
      });
      added++;
    } catch (e) {
      if (e.message.includes('Дубликат')) dup++;
      else { err++; console.error(`  ❌ ${c.username}: ${e.message}`); }
    }
  }
  console.log(`✅ +${added}, дубликатов: ${dup}, ошибок: ${err}`);
}

async function main() {
  const [cmd, slug, ...rest] = process.argv.slice(2);
  if (!cmd || !slug) {
    console.log(`suppliers-import — команды:

  from-outreach <project> [--min-score 50]   из outreach/candidates.json
  from-monitor  <project> [--min-subs 500]   из telegram-monitor/candidates.json
`);
    process.exit(cmd ? 1 : 0);
  }
  const args = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      const k = rest[i].slice(2);
      const v = rest[i + 1];
      if (v && !v.startsWith('--')) { args[k] = v; i++; }
    }
  }
  const p = projectPath(slug);

  if (cmd === 'from-outreach') {
    await importOutreach(p, { minScore: Number(args['min-score'] || 50) });
  } else if (cmd === 'from-monitor') {
    await importMonitor(p, { minSubs: Number(args['min-subs'] || 500) });
  } else {
    console.error('❌ Неизвестная команда');
    process.exit(1);
  }
}

main();
