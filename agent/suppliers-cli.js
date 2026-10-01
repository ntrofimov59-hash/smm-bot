#!/usr/bin/env node
// agent/suppliers-cli.js — управление базой поставщиков.
//
// Команды:
//   add <project> --category photographers --name "X" [--city yerevan] [--phone +374...] ...
//   list <project> [--category X] [--city yerevan] [--verified]
//   show <project> <id>
//   edit <project> <id> [--field value]
//   remove <project> <id>
//   stats <project>
//   import <project> <file.json>
//   export <project> [--category X] > dump.json

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import * as store from './suppliers/store.js';
import { CATEGORIES, SupplierError } from './suppliers/schemas.js';

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
      else { args.flags[key] = true; }
    } else args._.push(a);
  }
  return args;
}

function need(v, name) {
  if (!v) { console.error(`❌ Пропущен --${name}`); process.exit(1); }
  return v;
}

function parseList(v) {
  if (!v || v === true) return [];
  return String(v).split(',').map(s => s.trim()).filter(Boolean);
}

async function cmdAdd(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));

  const s = store.addSupplier(p, {
    category: need(args.flags.category, 'category'),
    name: need(args.flags.name, 'name'),
    city: args.flags.city || null,
    country: args.flags.country || null,
    languages: parseList(args.flags.languages),
    phone: args.flags.phone || null,
    email: args.flags.email || null,
    instagram: args.flags.instagram || null,
    telegram: args.flags.telegram || null,
    website: args.flags.website || null,
    priceRange: args.flags['price-range'] || null,
    priceNote: args.flags['price-note'] || null,
    capacity: args.flags.capacity ? Number(args.flags.capacity) : null,
    rating: args.flags.rating ? Number(args.flags.rating) : null,
    worksWithForeigners: !!args.flags['works-with-foreigners'],
    paymentTerms: args.flags['payment-terms'] || null,
    notes: args.flags.notes || null,
    tags: parseList(args.flags.tags),
    verified: !!args.flags.verified,
  });

  console.log(`✅ Добавлен: ${s.id} — ${s.name} (${s.category}/${s.city || '—'})`);
}

async function cmdList(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const list = store.listAll(p, {
    category: args.flags.category || null,
    city: args.flags.city || null,
    onlyVerified: !!args.flags.verified,
  });
  if (!list.length) { console.log('(пусто)'); return; }
  for (const s of list) {
    const contacts = [s.phone, s.instagram, s.email].filter(Boolean).join(' | ');
    console.log(`${s.id}  [${s.category.padEnd(13)}]  ${(s.city || '—').padEnd(11)}  ${s.name.padEnd(30)}  ${contacts}`);
  }
  console.log(`\nВсего: ${list.length}`);
}

async function cmdShow(args) {
  const [slug, id] = args._;
  const p = projectPath(need(slug, 'project'));
  const s = store.getSupplier(p, need(id, 'id'));
  if (!s) { console.error('❌ Не найден'); process.exit(1); }
  console.log(JSON.stringify(s, null, 2));
}

async function cmdEdit(args) {
  const [slug, id] = args._;
  const p = projectPath(need(slug, 'project'));
  const patch = {};
  const mapping = {
    name: 'name', city: 'city', phone: 'phone', email: 'email',
    instagram: 'instagram', telegram: 'telegram', website: 'website',
    'price-range': 'priceRange', 'price-note': 'priceNote',
    notes: 'notes', capacity: 'capacity', rating: 'rating',
    'works-with-foreigners': 'worksWithForeigners',
    'payment-terms': 'paymentTerms', verified: 'verified',
  };
  for (const [flag, field] of Object.entries(mapping)) {
    if (args.flags[flag] !== undefined) {
      let v = args.flags[flag];
      if (field === 'capacity' || field === 'rating') v = Number(v);
      if (field === 'verified' || field === 'worksWithForeigners') v = v === true || v === 'true';
      patch[field] = v;
    }
  }
  if (args.flags.languages) patch.languages = parseList(args.flags.languages);
  if (args.flags.tags) patch.tags = parseList(args.flags.tags);

  const s = store.updateSupplier(p, need(id, 'id'), patch);
  if (!s) { console.error('❌ Не найден'); process.exit(1); }
  console.log(`✅ Обновлён: ${s.name}`);
}

async function cmdRemove(args) {
  const [slug, id] = args._;
  const p = projectPath(need(slug, 'project'));
  const ok = store.removeSupplier(p, need(id, 'id'));
  console.log(ok ? '✅ Удалён' : '❌ Не найден');
}

async function cmdStats(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const st = store.stats(p);
  console.log(`📊 База поставщиков — ${slug}`);
  console.log(`\nВсего: ${st.total}\n`);
  for (const [cat, n] of Object.entries(st.byCategory)) {
    console.log(`  ${cat.padEnd(15)} ${n}`);
  }
}

async function cmdImport(args) {
  const [slug, file] = args._;
  const p = projectPath(need(slug, 'project'));
  need(file, 'file');

  if (!fs.existsSync(file)) {
    console.error(`❌ Нет файла: ${file}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const arr = Array.isArray(raw) ? raw : raw.suppliers;
  if (!Array.isArray(arr)) {
    console.error('❌ Ожидался массив или {suppliers: [...]}');
    process.exit(1);
  }

  let added = 0, dup = 0, err = 0;
  for (const item of arr) {
    try {
      store.addSupplier(p, item);
      added++;
    } catch (e) {
      if (e.message.includes('Дубликат')) dup++;
      else { err++; console.error('  ❌', e.message); }
    }
  }
  console.log(`✅ Импорт: +${added}, дубликатов: ${dup}, ошибок: ${err}`);
}

async function cmdExport(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const list = store.listAll(p, {
    category: args.flags.category || null,
    city: args.flags.city || null,
  });
  console.log(JSON.stringify({ suppliers: list }, null, 2));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  const handlers = {
    add: cmdAdd,
    list: cmdList,
    show: cmdShow,
    edit: cmdEdit,
    remove: cmdRemove,
    stats: cmdStats,
    import: cmdImport,
    export: cmdExport,
  };

  if (!cmd || !handlers[cmd]) {
    console.log(`suppliers-cli — команды:

  add <project> --category photographers --name "X" [--city yerevan] [--phone +374...]
      [--instagram @x] [--email x@y.z] [--website https://...]
      [--price-range $$] [--capacity 200] [--rating 4.8]
      [--languages ru,en] [--tags wedding,outdoor]
      [--works-with-foreigners] [--verified] [--notes "..."]

  list <project> [--category X] [--city yerevan] [--verified]
  show <project> <id>
  edit <project> <id> [--phone +374...] [--verified] [--notes "..."]
  remove <project> <id>
  stats <project>
  import <project> <file.json>
  export <project> [--category X]

Категории:
  ${CATEGORIES.join(', ')}
`);
    process.exit(cmd ? 1 : 0);
  }

  try {
    await handlers[cmd](args);
  } catch (e) {
    if (e instanceof SupplierError) {
      console.error('❌', e.message);
    } else {
      console.error('❌', e.message);
    }
    process.exit(1);
  }
}

main();
