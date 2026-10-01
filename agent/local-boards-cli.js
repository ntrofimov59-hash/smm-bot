#!/usr/bin/env node
// agent/local-boards-cli.js — управление парсингом локальных досок.
//
// Команды:
//   supported                          — список поддерживаемых городов
//   test <city> <category>             — тест: сколько нашлось
//   run <project> <city> [--category X] — обход с импортом в suppliers
//   run-all <project>                  — обход всех поддерживаемых городов

import 'dotenv/config';
import path from 'path';
import * as suppliers from './suppliers/store.js';
import { searchBoard, listSupportedCities, getAdapter } from './suppliers-discovery/local/index.js';
import { hasProxy } from './suppliers-discovery/local/proxy.js';

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
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v && !v.startsWith('--')) { args.flags[k] = v; i++; }
      else args.flags[k] = true;
    } else args._.push(a);
  }
  return args;
}

async function cmdSupported() {
  const cities = listSupportedCities();
  console.log('📋 Поддерживаемые города:');
  for (const c of cities) {
    const a = getAdapter(c);
    console.log(`  ${c.padEnd(12)} — ${a.name} (${a.categories.length} категорий)`);
    console.log(`    категории: ${a.categories.join(', ')}`);
  }
  console.log('');
  console.log(`Прокси: ${hasProxy() ? '✅ задан' : '❌ не задан (RESIDENTIAL_PROXY_URL)'}`);
  console.log(`Города без адаптера: пока не подключены — добавим по одному.`);
}

async function cmdTest(args) {
  const [city, category] = args._;
  if (!city || !category) {
    console.error('Использование: test <city> <category>');
    process.exit(1);
  }
  console.log(`🧪 Test ${city} / ${category}`);
  const r = await searchBoard({ city, category, strict: !!args.flags.strict });
  if (!r.ok) { console.error('❌', r.error); process.exit(1); }
  console.log(`   Доска: ${r.board}`);
  console.log(`   Найдено: ${r.found}`);
  console.log(`   Прошли фильтр: ${r.passed.length}`);
  console.log(`   Отклонено: ${r.rejected.length}`);
  if (r.passed.length) {
    console.log('\nТоп-5:');
    for (const c of r.passed.slice(0, 5)) {
      console.log(`  • ${c.name}  ${c.sourceUrl || ''}`);
    }
  }
  if (r.rejected.length) {
    console.log('\nПример отклонённых:');
    for (const c of r.rejected.slice(0, 3)) {
      console.log(`  ✗ ${c.name} — ${c._rejectReasons.join(', ')}`);
    }
  }
}

async function cmdRun(args) {
  const [slug, city] = args._;
  if (!slug || !city) {
    console.error('Использование: run <project> <city> [--category X]');
    process.exit(1);
  }
  const p = projectPath(slug);
  const adapter = getAdapter(city);
  if (!adapter) { console.error(`❌ Нет адаптера для ${city}`); process.exit(1); }

  const categories = args.flags.category ? [args.flags.category] : adapter.categories;
  const strict = !!args.flags.strict;

  let added = 0, dup = 0, err = 0, rejected = 0;

  for (const cat of categories) {
    console.log(`\n🌍 ${city} / ${cat}`);
    const r = await searchBoard({ city, category: cat, strict });
    if (!r.ok) { console.error('   ❌', r.error); continue; }
    rejected += r.rejected.length;

    for (const item of r.passed) {
      try {
        suppliers.addSupplier(p, {
          category: cat,
          name: item.name,
          city: item.city || city,
          country: item.country || null,
          phone: item.phone || null,
          email: item.email || null,
          instagram: item.instagram || null,
          telegram: item.telegram || null,
          website: item.website || null,
          rating: item.rating || null,
          notes: item.notes || null,
          source: item.source || 'local_board',
          sourceUrl: item.sourceUrl || null,
          verified: false,
          tags: item._qualityWarnings?.length ? ['#missing-data'] : [],
        });
        added++;
      } catch (e) {
        if (e.message.includes('Дубликат')) dup++;
        else { err++; console.error('   ❌', e.message); }
      }
    }
    console.log(`   ✅ +${r.passed.length}`);
    await new Promise(r => setTimeout(r, 2000)); // пауза между категориями
  }

  console.log(`\n📊 Итог: +${added} новых, дубликатов: ${dup}, ошибок: ${err}, отклонено фильтром: ${rejected}`);
}

async function cmdRunAll(args) {
  const [slug] = args._;
  if (!slug) { console.error('Использование: run-all <project>'); process.exit(1); }
  for (const city of listSupportedCities()) {
    await cmdRun({ _: [slug, city], flags: args.flags });
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  const handlers = {
    supported: cmdSupported,
    test: cmdTest,
    run: cmdRun,
    'run-all': cmdRunAll,
  };

  if (!cmd || !handlers[cmd]) {
    console.log(`local-boards-cli — команды:

  supported                       — список городов/категорий
  test <city> <category>          — тест парсинга
  run <project> <city> [--category X] [--strict]
  run-all <project> [--strict]

Примеры:
  node agent/local-boards-cli.js supported
  node agent/local-boards-cli.js test yerevan photographers
  node agent/local-boards-cli.js run coucou-events yerevan
  node agent/local-boards-cli.js run coucou-events yerevan --category venues --strict
`);
    process.exit(cmd ? 1 : 0);
  }

  try { await handlers[cmd](args); }
  catch (e) { console.error('❌', e.message); process.exit(1); }
}

main();
