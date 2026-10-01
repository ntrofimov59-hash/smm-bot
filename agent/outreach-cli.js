#!/usr/bin/env node
// agent/outreach-cli.js — CLI для модуля outreach.
//
// Использование:
//   node outreach-cli.js add <project> --name "..." --segment venue --city yerevan --phone +374... [--instagram @...]
//   node outreach-cli.js search <project> --query "wedding venue Yerevan" [--city yerevan] [--segment venue] [--limit 10]
//   node outreach-cli.js import <project>              (из outreach/manual.json)
//   node outreach-cli.js list <project> [--status found] [--segment venue] [--city yerevan]
//   node outreach-cli.js rank <project> [--top 10]
//   node outreach-cli.js draft <project> <id> [--lang ru]
//   node outreach-cli.js show <project> <id>
//   node outreach-cli.js approve <project> <id>
//   node outreach-cli.js sent <project> <id>
//   node outreach-cli.js replied <project> <id>
//   node outreach-cli.js reject <project> <id> [--reason "..."]
//   node outreach-cli.js dnc <project> <id>            (do_not_contact)
//   node outreach-cli.js followups <project>
//   node outreach-cli.js summary <project>
//   node outreach-cli.js stats <project>
//
// Ничего не отправляет. Генерирует черновики и ссылки для ручной отправки.

import 'dotenv/config';
import path from 'path';
import * as store from './outreach/store.js';
import * as ranker from './outreach/ranker.js';
import * as drafter from './outreach/drafter.js';
import * as links from './outreach/links.js';
import * as reminders from './outreach/reminders.js';
import * as sources from './outreach/sources/index.js';
import { searchOverpass } from './outreach/sources/overpass.js';
import { search2GIS } from './outreach/sources/twogis.js';
import { enrichCandidate } from './outreach/enrich.js';
import { loadProject } from './config-loader.js';

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
      if (next && !next.startsWith('--')) {
        args.flags[key] = next;
        i++;
      } else {
        args.flags[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function need(value, name) {
  if (!value) {
    console.error(`❌ Пропущен обязательный параметр: --${name}`);
    process.exit(1);
  }
  return value;
}

async function cmdAdd(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const c = store.addCandidate(p, {
    name: need(args.flags.name, 'name'),
    segment: args.flags.segment || 'other',
    city: args.flags.city || null,
    country: args.flags.country || null,
    language: args.flags.lang || 'ru',
    phone: args.flags.phone || null,
    email: args.flags.email || null,
    website: args.flags.website || null,
    instagram: args.flags.instagram || null,
    telegram: args.flags.telegram || null,
    address: args.flags.address || null,
    notes: args.flags.notes || null,
    source: 'cli',
  });
  console.log(`✅ Добавлен: ${c.id} — ${c.name}`);
}

async function cmdSearch(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const query = need(args.flags.query, 'query');

  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.error('❌ GOOGLE_PLACES_API_KEY не задан в .env');
    process.exit(1);
  }

  console.log(`🔍 Google Places: "${query}" ...`);
  const found = await sources.searchGooglePlaces(query, {
    city: args.flags.city || null,
    segment: args.flags.segment || 'venue',
    limit: Number(args.flags.limit || 20),
    regionCode: args.flags.region || null,
  });
  console.log(`Найдено: ${found.length}`);

  let added = 0, dup = 0;
  for (const c of found) {
    try {
      store.addCandidate(p, c);
      added++;
    } catch (e) {
      if (String(e.message).includes('дубликат')) dup++;
      else console.warn('  warning:', e.message);
    }
  }
  console.log(`✅ Добавлено: ${added}, дубликатов: ${dup}`);
}




async function cmdEnrich(args) {
  const [slug, id] = args._;
  const p = projectPath(need(slug, 'project'));

  const list = args.flags.all
    ? store.listCandidates(p, { status: args.flags.status || 'found' })
    : [store.getCandidate(p, need(id, 'id'))].filter(Boolean);

  if (!list.length) {
    console.error('❌ Не найдено');
    process.exit(1);
  }

  let ok = 0, noop = 0;
  for (const c of list) {
    process.stdout.write(`🔍 ${c.name} ... `);
    const r = await enrichCandidate(c);
    if (r.ok) {
      store.updateCandidate(p, c.id, r.updated);
      console.log(`✅ +${Object.keys(r.updated).join(', ')} (${r.source})`);
      ok++;
    } else {
      console.log('—');
      noop++;
    }
    await new Promise(r => setTimeout(r, 1200));
  }
  console.log(`\nОбогащено: ${ok}, без изменений: ${noop}`);
}

async function cmdSearch2GIS(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const city = need(args.flags.city, 'city');
  const segment = args.flags.segment || 'venue';

  console.log(`🏙  2GIS: ${city} (${segment}) ...`);
  const found = await search2GIS({
    city,
    segment,
    query: args.flags.query || null,
    limit: Number(args.flags.limit || 50),
    locale: args.flags.locale || null,
  });
  console.log(`Найдено: ${found.length}`);

  let added = 0, dup = 0;
  for (const c of found) {
    try { store.addCandidate(p, c); added++; }
    catch (e) { if (String(e.message).includes('дубликат')) dup++; }
  }
  console.log(`✅ Добавлено: ${added}, дубликатов: ${dup}`);
}

async function cmdSearchOsm(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const city = need(args.flags.city, 'city');
  const segment = args.flags.segment || 'venue';

  console.log(`🌍 Overpass/OSM: ${city} (${segment}) ...`);
  const found = await searchOverpass({
    city,
    country: args.flags.country || null,
    segment,
    radius: Number(args.flags.radius || 8000),
    limit: Number(args.flags.limit || 100),
  });
  console.log(`Найдено: ${found.length}`);

  let added = 0, dup = 0, noContact = 0;
  for (const c of found) {
    if (!c.phone && !c.email && !c.instagram && !c.website) {
      noContact++;
      // Всё равно добавляем — контакт можно найти вручную
    }
    try {
      store.addCandidate(p, c);
      added++;
    } catch (e) {
      if (String(e.message).includes('дубликат')) dup++;
      else console.warn('  warning:', e.message);
    }
  }
  console.log(`✅ Добавлено: ${added}, дубликатов: ${dup}`);
  if (noContact) console.log(`⚠️  Без прямых контактов: ${noContact} (проверь вручную)`);
}

async function cmdImport(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const list = sources.loadManualCandidates(p);
  if (!list.length) {
    console.log('ℹ️  outreach/manual.json пуст или не найден');
    return;
  }
  let added = 0, dup = 0;
  for (const c of list) {
    try { store.addCandidate(p, c); added++; }
    catch (e) { if (String(e.message).includes('дубликат')) dup++; }
  }
  console.log(`✅ Импортировано: ${added}, дубликатов: ${dup}`);
}

async function cmdList(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const list = store.listCandidates(p, {
    status: args.flags.status,
    segment: args.flags.segment,
    city: args.flags.city,
  });
  if (!list.length) {
    console.log('(пусто)');
    return;
  }
  for (const c of list) {
    const s = c.score != null ? `score=${c.score}` : 'score=—';
    console.log(`${c.id}  [${c.status}]  ${c.segment.padEnd(10)}  ${s.padEnd(10)}  ${c.name}${c.city ? ' (' + c.city + ')' : ''}`);
  }
  console.log(`\nВсего: ${list.length}`);
}

async function cmdRank(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const top = Number(args.flags.top || 20);
  const list = store.listCandidates(p).filter(c => c.status === 'found');
  const ranked = ranker.rankCandidates(list).slice(0, top);
  if (!ranked.length) {
    console.log('(нет кандидатов со статусом found)');
    return;
  }
  for (const c of ranked) {
    console.log(`${String(c.score).padStart(3)}  ${c.segment.padEnd(10)}  ${c.name}${c.city ? ' (' + c.city + ')' : ''}  ${c.phone || c.instagram || ''}`);
    console.log(`     ${JSON.stringify(c.breakdown)}`);
  }
}

async function cmdDraft(args) {
  const [slug, id] = args._;
  const p = projectPath(need(slug, 'project'));
  const c = store.getCandidate(p, need(id, 'id'));
  if (!c) { console.error('❌ Не найден'); process.exit(1); }

  const project = loadProject(p);
  console.log(`✍️  Генерирую черновик для ${c.name} (${c.segment}, ${c.city || '—'}) ...`);
  const r = await drafter.draftOutreach(c, project, args.flags.lang || null);
  if (!r.ok) { console.error('❌', r.error); process.exit(1); }

  store.updateCandidate(p, c.id, {
    drafted: { text: r.text, createdAt: new Date().toISOString(), lang: r.lang, tokens: r.tokens },
    status: 'drafted',
  });
  console.log(`✅ Черновик (${r.lang}, ${r.tokens} токенов):\n`);
  console.log(r.text);
  console.log(`\nПоказать: node agent/outreach-cli.js show ${slug} ${c.id}`);
}

async function cmdShow(args) {
  const [slug, id] = args._;
  const p = projectPath(need(slug, 'project'));
  const c = store.getCandidate(p, need(id, 'id'));
  if (!c) { console.error('❌ Не найден'); process.exit(1); }

  console.log(`\n📇 ${c.name}`);
  console.log(`   ${c.segment} / ${c.city || '—'} / ${c.language}`);
  console.log(`   status: ${c.status}${c.score != null ? '  score: ' + c.score : ''}`);
  if (c.phone)     console.log(`   ☎ ${c.phone}`);
  if (c.email)     console.log(`   ✉ ${c.email}`);
  if (c.instagram) console.log(`   📷 ${c.instagram}`);
  if (c.telegram)  console.log(`   ✈ ${c.telegram}`);
  if (c.website)   console.log(`   🌐 ${c.website}`);

  const draftText = c.drafted?.text || null;
  if (draftText) {
    console.log('\n📝 Черновик:\n');
    console.log(draftText);
  } else {
    console.log('\n(черновик ещё не сгенерирован: node agent/outreach-cli.js draft ' + slug + ' ' + c.id + ')');
  }

  const l = links.buildLinks(c, draftText);
  console.log('\n🔗 Ссылки для ручной отправки:');
  for (const [k, v] of Object.entries(l)) {
    console.log(`   ${k}: ${v}`);
  }

  console.log('\nПосле отправки: node agent/outreach-cli.js sent ' + slug + ' ' + c.id);
}

async function cmdStatus(args) {
  const [slug, id] = args._;
  const p = projectPath(need(slug, 'project'));
  const newStatus = args._[2];
  if (!newStatus) { console.error('❌ Укажи status: approve|sent|replied|reject|dnc'); process.exit(1); }
  const map = { approve: 'approved', sent: 'sent', replied: 'replied', reject: 'rejected', dnc: 'do_not_contact' };
  const status = map[newStatus];
  if (!status) { console.error('❌ Неизвестный статус'); process.exit(1); }
  const r = store.updateCandidate(p, need(id, 'id'), { status, notes: args.flags.reason });
  if (!r) { console.error('❌ Не найден'); process.exit(1); }
  console.log(`✅ ${r.name} → ${status}`);
}

async function cmdFollowups(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const all = store.listCandidates(p);
  const pending = reminders.getPendingFollowups(all);
  if (!pending.length) { console.log('(нет ожидающих follow-up)'); return; }
  console.log(`⏰ Follow-up (${pending.length}):`);
  for (const c of pending) {
    console.log(`  ${c.id}  ${c.daysSinceContact} дн.  ${c.name}  ${c.phone || c.instagram || ''}`);
  }
}

async function cmdSummary(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const all = store.listCandidates(p);
  const byStatus = {};
  for (const c of all) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  const ranked = ranker.rankCandidates(all.filter(c => c.status === 'found'));
  const followups = reminders.getPendingFollowups(all);

  console.log(`📊 ${slug}`);
  console.log('');
  for (const [s, n] of Object.entries(byStatus)) console.log(`  ${s.padEnd(18)} ${n}`);
  console.log('');
  if (ranked.length) {
    console.log('Топ-5 (found, отсортировано по score):');
    for (const c of ranked.slice(0, 5)) console.log(`  ${String(c.score).padStart(3)}  ${c.name}`);
  }
  if (followups.length) {
    console.log(`\n⏰ Follow-up: ${followups.length}`);
  }
}

async function cmdStats(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const all = store.listCandidates(p);
  console.log(JSON.stringify({ total: all.length, byStatus: all.reduce((a, c) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {}) }, null, 2));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  const handlers = {
    add: cmdAdd,
    search: cmdSearch,
    'search-osm': cmdSearchOsm,
    'search-2gis': cmdSearch2GIS,
    enrich: cmdEnrich,
    import: cmdImport,
    list: cmdList,
    rank: cmdRank,
    draft: cmdDraft,
    show: cmdShow,
    approve: (a) => cmdStatus({ ...a, _: [...a._, 'approve'] }),
    sent:    (a) => cmdStatus({ ...a, _: [...a._, 'sent'] }),
    replied: (a) => cmdStatus({ ...a, _: [...a._, 'replied'] }),
    reject:  (a) => cmdStatus({ ...a, _: [...a._, 'reject'] }),
    dnc:     (a) => cmdStatus({ ...a, _: [...a._, 'dnc'] }),
    followups: cmdFollowups,
    summary: cmdSummary,
    stats: cmdStats,
  };

  if (!cmd || !handlers[cmd]) {
    console.log(`outreach-cli — команды:

  add <project> --name "..." --segment venue --city yerevan [--phone +374...]
  search <project> --query "..." [--city yerevan] [--limit 10]  (Google Places)
  search-osm <project> --city yerevan [--segment venue] [--radius 8000]  (OpenStreetMap, без ключа)
  search-2gis <project> --city "Ереван" [--segment venue]  (2GIS, бесплатный демо-ключ)
  enrich <project> <id>                    (добрать контакты через OSM)
  enrich <project> --all [--status found]  (обогатить всех)
  import <project>                       (из outreach/manual.json)
  list <project> [--status found]
  rank <project> [--top 20]
  draft <project> <id> [--lang ru]
  show <project> <id>
  approve|sent|replied|reject|dnc <project> <id> [--reason "..."]
  followups <project>
  summary <project>
  stats <project>

Ничего не отправляет. Генерирует ссылки и текст — отправка вручную.
`);
    process.exit(cmd ? 1 : 0);
  }

  try {
    await handlers[cmd](args);
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  }
}

main();
