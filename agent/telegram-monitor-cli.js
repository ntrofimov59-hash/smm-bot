#!/usr/bin/env node
// agent/telegram-monitor-cli.js — управление Telegram-мониторингом.
//
// Команды:
//   login                              — интерактивный вход (генерирует session-строку)
//   add-channel <project> --username @x [--city yerevan] [--segment venue]
//   list-channels <project>
//   remove-channel <project> <username_or_id>
//   leads <project> [--limit 20] [--since 2026-10-01]
//   run <project>                      — запустить мониторинг (Ctrl+C для выхода)
//   stats <project>

import 'dotenv/config';
import path from 'path';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import * as store from './telegram-monitor/store.js';
import { runMonitor } from './telegram-monitor/index.js';
import { discover } from './telegram-monitor/discovery/index.js';
import { checkOne } from './telegram-monitor/checker.js';
import * as dstore from './telegram-monitor/discovery-store.js';
import { scoreCandidate } from './telegram-monitor/scorer.js';

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

function need(value, name) {
  if (!value) { console.error(`❌ Пропущен --${name}`); process.exit(1); }
  return value;
}


async function cmdDiscover(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const query = need(args.flags.query, 'query');
  const limit = Number(args.flags.limit || 30);
  const skipSubscribed = args.flags['skip-subscribed'] !== false; // по умолчанию true

  console.log(`🔎 Поиск: "${query}" (limit ${limit})`);
  let items = await discover(query, { limit });
  console.log(`Найдено: ${items.length}`);

  if (!items.length) return;

  // Исключаем тех, на кого уже подписан userbot
  if (skipSubscribed) {
    try {
      const { createClient } = await import('./telegram-monitor/index.js');
      const { getSubscribedUsernames, filterNew } = await import('./telegram-monitor/subscriptions.js');
      const client = await createClient();
      const subs = await getSubscribedUsernames(client);
      await client.disconnect();

      const before = items.length;
      items = filterNew(items, subs);
      const filtered = before - items.length;
      if (filtered > 0) console.log(`   🚫 Исключено уже подписанных: ${filtered}`);
    } catch (e) {
      console.error(`   ⚠️  не удалось проверить подписки: ${e.message}`);
    }
  }

  if (!items.length) {
    console.log('   (все уже подписаны или мусор)');
    return;
  }

  const { added, dup } = dstore.addMany(p, items);
  console.log(`✅ Добавлено: ${added}, дубликатов: ${dup}`);
  console.log(`   Всего в базе: ${dstore.listCandidates(p).length}`);
}


async function cmdDailyDigest(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));

  const minSubs = Number(args.flags['min-subs'] || 500);
  const minScore = Number(args.flags['min-score'] || 50);

  const all = dstore.listCandidates(p);

  // Берём ВСЕ verified с достаточными подписчиками и score.
  // НЕ фильтруем по discoveredAt — если канал не был отправлен ранее,
  // он должен прийти. После отправки пометим как notified.
  const goodVerified = all.filter(c => {
    if (c.status !== 'verified') return false;
    if (typeof c.subscribers !== 'number') return false;
    if (c.subscribers < minSubs) return false;
    return true;
  });

  // Считаем score и фильтруем по нему
  const scored = goodVerified
    .map(c => ({ ...c, _scored: scoreCandidate(c) }))
    .filter(c => c._scored.score >= minScore)
    .sort((a, b) => b._scored.score - a._scored.score);

  // Что ещё не отправлялось
  const notNotified = scored.filter(c => c.status === 'verified');

  // Свежие лиды
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const leads = store.listLeads(p, { since, limit: 100 });

  const botToken = process.env.ANALYTICS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ANALYTICS_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.error('❌ Нет TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID');
    process.exit(1);
  }

  const lines = ['📬 <b>Coucou Daily Digest</b>', ''];

  if (notNotified.length) {
    lines.push(`🆕 <b>Новые каналы для подписки (≥${minSubs}):</b> ${notNotified.length}`);
    for (const c of notNotified.slice(0, 15)) {
      const type = c.reviewData?.type === 'megagroup' ? '📢' : '📻';
      lines.push(`${type} <b>@${c.username}</b> — ${c.subscribers.toLocaleString()}`);
      if (c.title) lines.push(`   <i>${c.title.slice(0, 80)}</i>`);
      lines.push(`   👉 <a href="https://t.me/${c.username}">Подписаться</a>`);
    }
    if (notNotified.length > 15) {
      lines.push(`   <i>...ещё ${notNotified.length - 15} в очереди</i>`);
    }
    lines.push('');
  } else {
    lines.push(`🆕 Новых каналов нет`);
    lines.push('');
  }

  lines.push(`🟢 <b>Всего годных в базе:</b> ${scored.length}`);
  lines.push('');

  if (leads.length) {
    lines.push(`🎯 <b>Свежих заявок (24ч):</b> ${leads.length}`);
    for (const l of leads.slice(0, 15)) {
      const t = l.text.slice(0, 120).replace(/\n/g, ' ');
      lines.push(`   • [${l.match?.city || '?'}] ${t}`);
      if (l.messageUrl) lines.push(`     ${l.messageUrl}`);
    }
  } else {
    lines.push('🎯 Свежих заявок нет');
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join('\n'),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json();
  if (!data.ok) { console.error('❌ Telegram:', data.description); process.exit(1); }

  // Помечаем показанные каналы как notified — чтобы не приходили снова
  for (const c of notNotified.slice(0, 15)) {
    dstore.updateCandidate(p, c.username, {
      status: 'notified',
      notifiedAt: new Date().toISOString(),
    });
  }

  console.log(`✅ Digest: ${Math.min(notNotified.length, 15)} отправлено, ${scored.length} всего годных, ${leads.length} лидов`);
}

async function cmdDailyDiscovery(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const fs = await import('fs');

  const queriesFile = `${p}/telegram-monitor/discovery-queries.json`;
  if (!fs.existsSync(queriesFile)) {
    console.error(`❌ Нет ${queriesFile}`);
    process.exit(1);
  }
  const cities = JSON.parse(fs.readFileSync(queriesFile, 'utf8'));

  const { createClient } = await import('./telegram-monitor/index.js');
  const { getSubscribedUsernames, filterNew } = await import('./telegram-monitor/subscriptions.js');
  const client = await createClient();
  const subs = await getSubscribedUsernames(client);
  console.log(`👤 userbot подписан на ${subs.size} чатов`);

  let totalAdded = 0;

  for (const [city, cfg] of Object.entries(cities)) {
    console.log(`\n🌍 ${city} (${cfg.queries.length} запросов)`);
    for (const q of cfg.queries) {
      try {
        let items = await discover(q, { limit: 15 });
        items = filterNew(items, subs);
        if (items.length) {
          const { added } = dstore.addMany(p, items);
          if (added) console.log(`   "${q}" → +${added}`);
          totalAdded += added;
        }
      } catch (e) {
        console.error(`   "${q}" ❌ ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\n✅ Всего добавлено: ${totalAdded}`);
  await client.disconnect();
}

async function cmdReview(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const limit = Number(args.flags.limit || 60);
  const concurrency = Number(args.flags.concurrency || 3);
  const maxRetries = Number(args.flags.retries || 3);

  const pending = dstore.listCandidates(p, { status: 'pending' }).slice(0, limit);
  if (!pending.length) {
    console.log('(нет кандидатов со статусом pending)');
    return;
  }

  console.log(`📡 Проверяю ${pending.length} (параллельно ${concurrency}, retry до ${maxRetries})...`);

  const { createClient } = await import('./telegram-monitor/index.js');
  let client = await createClient();

  let ok = 0, fail = 0, skipped = 0;
  let idx = 0;
  const stop = false;

  // Обёртка с retry на TIMEOUT / сетевые ошибки
  async function checkWithRetry(username) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const r = await checkOne(client, username);
        return r;
      } catch (e) {
        const msg = String(e.message || e);
        const isNetwork = /TIMEOUT|ECONNRESET|socket hang up|EFATAL|ECONNREFUSED|RPCError/i.test(msg);
        if (!isNetwork) {
          // логическая ошибка (USERNAME_INVALID и т.п.) — не retry
          return { ok: false, error: msg };
        }
        console.log(`      ⚠️ попытка ${attempt}/${maxRetries}: ${msg.slice(0, 80)}`);
        if (attempt < maxRetries) {
          // Пересоздаём клиент
          try { await client.disconnect(); } catch {}
          await new Promise(r => setTimeout(r, 3000 * attempt));
          try {
            client = await createClient();
          } catch (e2) {
            console.log(`      ❌ переподключение не удалось: ${e2.message}`);
          }
        }
      }
    }
    return { ok: false, error: 'retries exhausted' };
  }

  async function worker() {
    while (idx < pending.length && !stop) {
      const i = idx++;
      const c = pending[i];

      let r;
      try {
        r = await checkWithRetry(c.username);
      } catch (e) {
        console.log(`  [${i+1}/${pending.length}] ⚠️ ${c.username} — ${e.message}`);
        skipped++;
        continue;
      }

      if (r.ok) {
        const subs = r.subscribers ? r.subscribers.toLocaleString() : '?';
        console.log(`  [${i+1}/${pending.length}] ✅ @${c.username.padEnd(28)} ${r.type.padEnd(9)} ${subs.padStart(8)}`);
        dstore.updateCandidate(p, c.username, {
          status: 'verified',
          reviewedAt: new Date().toISOString(),
          title: r.title,
          subscribers: r.subscribers,
          description: r.about || c.description,
          reviewData: { type: r.type, verified: r.verified, scam: r.scam },
        });
        ok++;
      } else if (/FLOOD_WAIT|flood/i.test(String(r.error))) {
        console.log(`  ⏸ FLOOD WAIT — пауза 60 сек, потом продолжаю`);
        await new Promise(res => setTimeout(res, 60000));
        // не останавливаем, пробуем дальше
      } else {
        dstore.updateCandidate(p, c.username, {
          status: 'rejected',
          reviewedAt: new Date().toISOString(),
          rejectReason: r.error,
        });
        fail++;
      }

      // Мягкая пауза между задачами (можно варьировать)
      await new Promise(res => setTimeout(res, 800));
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  try { await client.disconnect(); } catch {}

  console.log(`\n✅ ok: ${ok}, fail: ${fail}${skipped ? ', skipped: ' + skipped : ''}`);
  const remaining = dstore.listCandidates(p, { status: 'pending' }).length;
  if (remaining) console.log(`Осталось pending: ${remaining}. Запусти ещё раз — продолжит.`);
}

async function cmdCandidates(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const status = args.flags.status || null;
  const list = dstore.listCandidates(p, { status });
  if (!list.length) { console.log('(пусто)'); return; }

  const scored = list.map(c => ({ ...c, _scored: scoreCandidate(c) }));
  scored.sort((a, b) => b._scored.score - a._scored.score);

  for (const c of scored) {
    const s = c._scored;
    const subs = c.subscribers ? `${c.subscribers.toLocaleString()}` : '?';
    const type = c.reviewData?.type ? c.reviewData.type.slice(0, 9) : '';
    const verdict = s.verdict === 'keep' ? '🟢' : s.verdict === 'drop' ? '🔴' : '🟡';
    console.log(`${verdict} ${String(s.score).padStart(3)}  ${c.status.padEnd(9)}  @${c.username.padEnd(28)}  ${type.padEnd(9)}  ${subs.padStart(8)}  ${(c.title || c.context || '').slice(0, 50)}`);
  }
  console.log(`\nВсего: ${list.length}`);
}

async function cmdTopCandidates(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const status = args.flags.status || 'verified';
  const minScore = Number(args.flags['min-score'] || 50);
  const minSubs = Number(args.flags['min-subs'] || 500);

  const list = dstore.listCandidates(p, { status });
  const scored = list
    .filter(c => {
      if (typeof c.subscribers !== 'number') return false;
      return c.subscribers >= minSubs;
    })
    .map(c => ({ ...c, _scored: scoreCandidate(c) }))
    .filter(c => c._scored.score >= minScore)
    .sort((a, b) => b._scored.score - a._scored.score);

  if (!scored.length) {
    console.log(`(нет кандидатов: subs >= ${minSubs}, score >= ${minScore})`);
    return;
  }

  console.log(`Топ кандидатов (subs >= ${minSubs}, score >= ${minScore}):\n`);
  for (const c of scored) {
    const type = c.reviewData?.type === 'megagroup' ? '📢' : '📻';
    console.log(`${type} ${c._scored.score}  @${c.username}  (${c.subscribers?.toLocaleString() || '?'})  ${c.title || ''}`);
    for (const r of c._scored.reasons) console.log(`      ${r}`);
    console.log(`      https://t.me/${c.username}`);
    console.log('');
  }
}

async function cmdApprove(args) {
  const [slug, username] = args._;
  const p = projectPath(need(slug, 'project'));
  need(username, 'username');
  const c = dstore.updateCandidate(p, username, {
    status: 'approved',
    approvedAt: new Date().toISOString(),
  });
  if (!c) { console.error('❌ не найден'); process.exit(1); }
  console.log(`✅ @${c.username} одобрен. Подпишись: https://t.me/${c.username}`);
}

async function cmdDismiss(args) {
  const [slug, username] = args._;
  const p = projectPath(need(slug, 'project'));
  need(username, 'username');
  const c = dstore.updateCandidate(p, username, {
    status: 'dismissed',
    rejectReason: args.flags.reason || 'manual',
  });
  if (!c) { console.error('❌ не найден'); process.exit(1); }
  console.log(`⏭  @${c.username} отклонён`);
}

async function cmdNotifyCandidates(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const approved = dstore.listCandidates(p, { status: 'approved' });

  if (!approved.length) { console.log('(нет approved)'); return; }

  // Поддерживаем оба варианта имён: ANALYTICS_* (новый стиль) и TELEGRAM_* (как в проекте)
  const botToken = process.env.ANALYTICS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ANALYTICS_CHAT_ID || process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!botToken) {
    console.error('❌ Не задан TELEGRAM_BOT_TOKEN (или ANALYTICS_BOT_TOKEN)');
    process.exit(1);
  }
  if (!chatId) {
    console.error('❌ Не задан TELEGRAM_CHAT_ID (или ANALYTICS_CHAT_ID)');
    console.error("   Узнать: curl -s 'https://api.telegram.org/bot<TOKEN>/getUpdates' | jq '.result[-1].message.chat.id'");
    process.exit(1);
  }

  // Сортируем по score
  const scored = approved.map(c => ({ ...c, _scored: scoreCandidate(c) }))
    .sort((a, b) => b._scored.score - a._scored.score);

  const lines = ['🔎 <b>Новые площадки для мониторинга</b>', ''];
  for (const c of scored.slice(0, 30)) {
    const subs = c.subscribers ? `${c.subscribers.toLocaleString()} подписчиков` : '';
    const type = c.reviewData?.type ? `${c.reviewData.type}` : '';
    lines.push(`• <b>@${c.username}</b> [score=${c._scored?.score || '?'}] ${type ? '['+type+']' : ''} ${subs}`);
    if (c.title) lines.push(`   «${c.title.slice(0,80)}»`);
    if (c.description) lines.push(`   ${c.description.slice(0, 120)}`);
    lines.push(`   👉 <a href="https://t.me/${c.username}">https://t.me/${c.username}</a>`);
    lines.push('');
  }
  lines.push('Подпишись на нужные вручную, потом добавь их в мониторинг:');
  lines.push('<code>node agent/telegram-monitor-cli.js add-channel coucou-events --username @X --city Y</code>');

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join('\n'),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json();
  if (!data.ok) { console.error('❌ Telegram API:', data.description); process.exit(1); }
  console.log(`✅ Отправлено ${approved.length} площадок в бот`);

  // Помечаем как notified, чтобы не спамить
  for (const c of approved) {
    dstore.updateCandidate(p, c.username, { status: 'notified', notifiedAt: new Date().toISOString() });
  }
}

async function cmdLogin() {
  const apiId = Number(process.env.TELEGRAM_MONITOR_API_ID);
  const apiHash = process.env.TELEGRAM_MONITOR_API_HASH;
  if (!apiId || !apiHash) {
    console.error('❌ Сначала задай в .env:');
    console.error('   TELEGRAM_MONITOR_API_ID=<число>');
    console.error('   TELEGRAM_MONITOR_API_HASH=<строка>');
    console.error('');
    console.error('Получить: https://my.telegram.org/apps');
    process.exit(1);
  }

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
  const rl = createInterface({ input, output });

  await client.start({
    phoneNumber: async () => rl.question('Телефон (+374...): '),
    password: async () => rl.question('Пароль 2FA (если есть): '),
    phoneCode: async () => rl.question('Код из Telegram: '),
    onError: (e) => console.error('❌', e.message),
  });

  const session = client.session.save();
  await client.disconnect();
  rl.close();

  console.log('');
  console.log('✅ Логин выполнен!');
  console.log('');
  console.log('Добавь в .env строку:');
  console.log('');
  console.log(`TELEGRAM_MONITOR_SESSION=${session}`);
  console.log('');
  console.log('⚠️  Никому не показывай эту строку — это доступ к аккаунту.');
}


async function cmdCheck(args) {
  const [slug, ...usernames] = args._;
  // p не используется, только для валидации slug
  projectPath(need(slug, 'project'));
  const { createClient } = await import('./telegram-monitor/index.js');
  const client = await createClient();

  for (const raw of usernames) {
    const u = String(raw).replace(/^@/, '');
    try {
      const entity = await client.getEntity('@' + u);
      const full = await client.invoke({
        _: 'channels.getFullChannel',
        channel: entity,
      }).catch(() => null);
      const subs = full?.fullChat?.participantsCount || '?';
      console.log(`✅ @${u}  «${entity.title}»  подписчиков: ${subs}`);
    } catch (e) {
      console.log(`❌ @${u}  — ${e.message}`);
    }
  }
  await client.disconnect();
}

async function cmdAddChannel(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));

  const username = args.flags.username;
  const id = args.flags.id;
  const title = args.flags.title;

  if (!username && !id) {
    console.error('❌ Нужен --username @channel или --id <число>');
    process.exit(1);
  }

  const ch = store.addChannel(p, {
    username: username ? String(username).replace(/^@/, '') : null,
    id: id ? String(id) : null,
    title: title || username || id,
    city: args.flags.city || null,
    segment: args.flags.segment || 'other',
    language: args.flags.lang || 'ru',
    enabled: args.flags.disabled !== true,
  });
  console.log(`✅ Добавлен канал: ${ch.title} (${ch.city || '—'}, ${ch.segment})`);
}

async function cmdListChannels(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const data = store.loadChannels(p);
  if (!data.channels.length) {
    console.log('(нет каналов)');
    return;
  }
  for (const ch of data.channels) {
    const status = ch.enabled ? '🟢' : '⚪';
    console.log(`${status}  ${ch.username || ch.id}  (${ch.city || '—'}, ${ch.segment}, ${ch.language})`);
    if (ch.title && ch.title !== ch.username) console.log(`     «${ch.title}»`);
  }
  console.log(`\nВсего: ${data.channels.length}`);
}

async function cmdRemoveChannel(args) {
  const [slug, key] = args._;
  const p = projectPath(need(slug, 'project'));
  need(key, 'username_or_id');

  const data = store.loadChannels(p);
  const clean = String(key).replace(/^@/, '');
  const before = data.channels.length;
  data.channels = data.channels.filter(c =>
    c.id !== clean && c.username !== clean
  );
  if (data.channels.length === before) {
    console.error(`❌ Не найден: ${key}`);
    process.exit(1);
  }
  store.saveChannels(p, data);
  console.log(`✅ Удалён ${key}`);
}

async function cmdLeads(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const leads = store.listLeads(p, {
    since: args.flags.since || null,
    limit: Number(args.flags.limit || 20),
  });
  if (!leads.length) {
    console.log('(нет лидов)');
    return;
  }
  for (const l of leads) {
    const t = new Date(l.foundAt).toLocaleString('ru-RU');
    console.log(`[${t}] ${l.chatTitle || l.chatUsername} (${l.match?.city || '—'})`);
    console.log(`  ${l.text.slice(0, 200)}`);
    if (l.messageUrl) console.log(`  ${l.messageUrl}`);
    if (l.match?.keywords?.length) {
      const kws = l.match.keywords.map(k => k.keyword).join(', ');
      console.log(`  → keywords: ${kws}`);
    }
    if (l.match?.intent) {
      console.log(`  → intent: ${l.match.intent.professions.join(', ')}`);
    }
    console.log('');
  }
  console.log(`Всего: ${leads.length}`);
}

async function cmdRun(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));

  console.log('🚀 Запускаю Telegram-мониторинг. Ctrl+C для остановки.');
  const { client } = await runMonitor({
    projectPath: p,
    onLog: (m) => console.log(m),
    onLead: async (lead) => {
      // 1) оффер поставщика из текста → suppliers/ (verified: false, city с канала)
      try {
        const { ingestLeadAsSupplier } = await import('./suppliers/from-telegram.js');
        const leadForSupplier = {
          text: lead.text,
          city: lead.match?.city || null,
          messageUrl: lead.messageUrl || null,
        };
        const sr = ingestLeadAsSupplier(p, leadForSupplier);
        if (sr.ok) console.log(`📦 supplier + ${sr.supplier.name} [${sr.supplier.category}/${sr.supplier.city}]`);
      } catch (e) {
        console.warn('supplier ingest:', e.message);
      }

      // 2) уведомление в бот аналитики
      const botToken = process.env.ANALYTICS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.ANALYTICS_CHAT_ID || process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID;
      if (!botToken || !chatId) return;
      const text = `🎯 [TG-monitor] ${lead.chatTitle || ''}\n\n${lead.text.slice(0, 300)}\n\n${lead.messageUrl || ''}`;
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        });
      } catch { /* ignore */ }
    },
  });

  process.on('SIGINT', async () => {
    console.log('\n⏸  остановка...');
    await client.disconnect();
    process.exit(0);
  });

  // Держим процесс живым
  setInterval(() => {}, 1000 * 60 * 60);
}

async function cmdStats(args) {
  const [slug] = args._;
  const p = projectPath(need(slug, 'project'));
  const channels = store.loadChannels(p).channels;
  const leads = store.listLeads(p, { limit: 10000 });

  const byCity = {};
  for (const l of leads) {
    const c = l.match?.city || 'unknown';
    byCity[c] = (byCity[c] || 0) + 1;
  }

  console.log(`📊 Telegram-monitor — ${slug}`);
  console.log('');
  console.log(`Каналов: ${channels.length} (активных: ${channels.filter(c => c.enabled).length})`);
  console.log(`Найдено лидов: ${leads.length}`);
  console.log('');
  console.log('По городам:');
  for (const [c, n] of Object.entries(byCity)) console.log(`  ${c.padEnd(15)} ${n}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  const handlers = {
    login: cmdLogin,
    check: cmdCheck,
    discover: cmdDiscover,
    'daily-discovery': cmdDailyDiscovery,
    digest: cmdDailyDigest,
    review: cmdReview,
    candidates: cmdCandidates,
    'top-candidates': cmdTopCandidates,
    approve: cmdApprove,
    dismiss: cmdDismiss,
    notify: cmdNotifyCandidates,
    'add-channel': cmdAddChannel,
    'list-channels': cmdListChannels,
    'remove-channel': cmdRemoveChannel,
    leads: cmdLeads,
    run: cmdRun,
    stats: cmdStats,
  };

  if (!cmd || !handlers[cmd]) {
    console.log(`telegram-monitor-cli — команды:

  login                                          интерактивный вход (генерация session)
  check <project> @user1 @user2 [...]              проверить существование каналов
  discover <project> --query "yerevan expats" [--limit 30]   поиск новых каналов
  review <project>                               проверить pending через userbot
  daily-discovery <project>                      обойти все города и запросы
  digest <project>                               отправить сводку за сутки в бот
  candidates <project> [--status pending|verified|approved]  список со скорингом
  top-candidates <project> [--min-score 50]                 топ по релевантности
  approve <project> @user                      одобрить (готов подписаться)
  dismiss <project> @user                      отклонить
  notify <project>                              отправить approved в Telegram-бот
  add-channel <project> --username @x [--city yerevan] [--segment venue]
  list-channels <project>
  remove-channel <project> <@username>
  leads <project> [--limit 20] [--since 2026-10-01]
  run <project>                                  запустить мониторинг
  stats <project>

Только чтение. Ничего не отправляется от имени userbot.
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

// Аудит — для внутренней отладки. Вставляется в конец файла, но main() уже вызван.
// Используй: node -e "import('./agent/telegram-monitor-cli.js')" — не сработает.
// Поэтому отлаживаем через отдельный скрипт: см. /tmp/audit.mjs
