#!/usr/bin/env node
// agent/suppliers-cli.js
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import * as store from './suppliers/store.js';
import { fetchSuppliersGeo } from './suppliers/fetch-geo.js';
import { ingestLeadsBatch } from './suppliers/from-telegram.js';
import { extractSupplierOffer } from './suppliers/extract-offer.js';

function projectPath(slug) {
  const root = process.env.PROJECTS_ROOT
    ? path.resolve(process.env.PROJECTS_ROOT)
    : path.resolve(new URL('../projects/', import.meta.url).pathname);
  return path.join(root, slug);
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args.flags[key] = next; i++; }
      else args.flags[key] = true;
    } else args._.push(a);
  }
  return args;
}

function need(v, n) {
  if (!v) { console.error(`❌ нужен --${n}`); process.exit(1); }
  return v;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, slug] = args._;
  if (!cmd || cmd === 'help') {
    console.log(`suppliers-cli

  stats <project>
  list <project> --city yerevan [--category photographers] [--verified]
  verify <project> <id>
  unverify <project> <id>
  add <project> --category photographers --name "..." --city yerevan [--phone ...] [--instagram ...]
  fetch <project> --city yerevan --category venues [--source osm|2gis|both] [--limit 40]
  from-leads <project> [--since 2026-10-01] [--limit 200]
  parse-text --city yerevan "я фотограф, +374..."
  boards <project> [--city yerevan]
`);
    return;
  }

  const p = projectPath(need(slug || args.flags.project, 'project'));

  if (cmd === 'stats') {
    console.log(store.stats(p));
    return;
  }

  if (cmd === 'list') {
    const list = store.listAll(p, {
      city: args.flags.city || null,
      category: args.flags.category || null,
      onlyVerified: !!args.flags.verified,
    });
    for (const s of list) {
      console.log(`${s.id} ${s.verified ? '✅' : '·'} [${s.category}] ${s.city || '—'} ${s.name} ${s.phone || s.instagram || ''}`);
    }
    console.log(`\nВсего: ${list.length}`);
    return;
  }

  if (cmd === 'verify' || cmd === 'unverify') {
    const id = args._[2];
    need(id, 'id');
    const s = store.updateSupplier(p, id, { verified: cmd === 'verify' });
    console.log(s ? `✅ ${s.name} verified=${s.verified}` : 'не найден');
    return;
  }

  if (cmd === 'add') {
    const s = store.addSupplier(p, {
      category: need(args.flags.category, 'category'),
      name: need(args.flags.name, 'name'),
      city: need(args.flags.city, 'city'),
      phone: args.flags.phone,
      instagram: args.flags.instagram,
      telegram: args.flags.telegram,
      email: args.flags.email,
      website: args.flags.website,
      verified: !!args.flags.verified,
      source: 'cli',
    });
    console.log('✅', s.id, s.name);
    return;
  }

  if (cmd === 'fetch') {
    const r = await fetchSuppliersGeo(p, {
      city: need(args.flags.city, 'city'),
      category: need(args.flags.category, 'category'),
      source: args.flags.source || 'osm',
      limit: Number(args.flags.limit || 40),
    });
    console.log(r);
    return;
  }

  if (cmd === 'from-leads') {
    const tm = await import('./telegram-monitor/store.js');
    let leads = tm.listLeads(p, {
      since: args.flags.since || null,
      limit: Number(args.flags.limit || 200),
    });
    // listLeads уже newest-first; нормализуем city из match
    leads = leads.map((l) => ({
      text: l.text,
      city: l.match?.city || l.city || null,
      messageUrl: l.messageUrl || null,
      foundAt: l.foundAt,
    }));
    console.log(`Лидов: ${leads.length}`);
    const r = ingestLeadsBatch(p, leads);
    console.log(r);
    return;
  }

  if (cmd === 'parse-text') {
    const text = args._.slice(1).join(' ') || args.flags.text;
    const offer = extractSupplierOffer(text, { city: args.flags.city });
    console.log(offer || '(не оффер)');
    return;
  }

  if (cmd === 'boards') {
    const f = path.join(p, 'suppliers', 'boards.json');
    if (!fs.existsSync(f)) { console.log('нет boards.json'); return; }
    const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
    const city = args.flags.city;
    if (city) console.log(JSON.stringify(cfg.cities[city] || {}, null, 2));
    else console.log(Object.keys(cfg.cities || {}));
    return;
  }

  console.error('неизвестная команда', cmd);
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
