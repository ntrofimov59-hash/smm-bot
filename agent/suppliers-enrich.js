#!/usr/bin/env node
// agent/suppliers-enrich.js — обогащение suppliers через Telegram userbot.
// Для каждого supplier с telegram-username и без bio/contacts — берём bio из Telegram.
//
// Запуск:
//   node agent/suppliers-enrich.js run <project> [--limit 100] [--category X]

import 'dotenv/config';
import path from 'path';
import * as suppliers from './suppliers/store.js';
import { createClient } from './telegram-monitor/index.js';
import { classifyText, extractContacts } from './suppliers-discovery/classify.js';

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

// Кому нужен enrich: есть telegram, но нет notes (bio) или phone/email
function needsEnrich(s) {
  if (!s.telegram) return false;
  const hasBio = s.notes && s.notes.length > 20;
  const hasContacts = s.phone || s.email || s.website;
  return !hasBio || !hasContacts;
}

async function getTelegramInfo(client, username) {
  try {
    const u = String(username).replace(/^@/, '');
    const entity = await client.getEntity('@' + u);

    // Bio и full info
    let bio = null;
    let participantsCount = null;
    try {
      const full = await client.invoke({
        _: 'channels.getFullChannel',
        channel: entity,
      });
      bio = full.fullChat?.about || null;
      participantsCount = full.fullChat?.participantsCount || null;
    } catch {
      // это user, не канал
      try {
        const fullUser = await client.invoke({
          _: 'users.getFullUser',
          id: entity,
        });
        bio = fullUser.fullUser?.about || null;
      } catch { /* ignore */ }
    }

    return {
      ok: true,
      title: entity.title || entity.firstName || u,
      bio,
      username: entity.username || u,
      isChannel: !!entity.broadcast,
      isGroup: !!entity.megagroup,
      participantsCount,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function main() {
  const [cmd, slug, ...rest] = process.argv.slice(2);
  if (cmd !== 'run' || !slug) {
    console.log(`suppliers-enrich — команда:

  run <project> [--limit 100] [--category photographers] [--retries 2]

Обогащает записи у которых есть telegram, но нет bio/контактов.
`);
    process.exit(cmd && slug ? 0 : 1);
  }

  const args = parseArgs(rest);
  const p = projectPath(slug);
  const limit = Number(args.flags.limit || 100);
  const category = args.flags.category || null;

  // Собираем список
  const all = suppliers.listAll(p, { category });
  const targets = all.filter(needsEnrich).slice(0, limit);

  if (!targets.length) {
    console.log('✅ Все suppliers уже обогащены (или нет telegram)');
    return;
  }

  console.log(`📡 Enrich ${targets.length} suppliers через userbot...`);
  const client = await createClient();

  let ok = 0, fail = 0, skipped = 0;

  for (let i = 0; i < targets.length; i++) {
    const s = targets[i];
    process.stdout.write(`  [${i+1}/${targets.length}] @${s.telegram.padEnd(25)} ... `);

    const info = await getTelegramInfo(client, s.telegram);
    if (!info.ok) {
      console.log(`❌ ${info.error}`);
      fail++;
      // Flood wait — пауза
      if (/FLOOD_WAIT|flood/i.test(info.error)) {
        console.log('  ⏸  FLOOD WAIT — пауза 60 сек');
        await new Promise(r => setTimeout(r, 60000));
      }
      continue;
    }

    // Собираем обновления
    const patch = {};
    if (info.bio && (!s.notes || s.notes.length < info.bio.length)) {
      patch.notes = info.bio;
    }
    if (info.title && info.title !== s.name && s.name.length < 5) {
      patch.name = info.title;
    }

    // Извлекаем контакты из bio
    const contacts = extractContacts(info.bio || '');
    if (contacts.phone && !s.phone) patch.phone = contacts.phone;
    if (contacts.email && !s.email) patch.email = contacts.email;
    if (contacts.website && !s.website) patch.website = contacts.website;
    if (contacts.instagram && !s.instagram) patch.instagram = contacts.instagram;

    // Уточняем категорию
    if (info.bio) {
      const newCat = classifyText(`${info.title || ''} ${info.bio}`, s.category);
      if (newCat !== 'other' && newCat !== s.category) {
        // Меняем категорию — но это tricky, нужен перенос между файлами
        // Пока оставляем, пометим в tags
        patch.tags = [...(s.tags || []), `#suggest:${newCat}`];
      }
    }

    if (Object.keys(patch).length === 0) {
      console.log('— (нет новых данных)');
      skipped++;
      continue;
    }

    suppliers.updateSupplier(p, s.id, patch);
    const summary = Object.keys(patch).join(', ');
    console.log(`✅ +${summary}`);
    ok++;

    await new Promise(r => setTimeout(r, 800));
  }

  await client.disconnect();
  console.log(`\n✅ Обогащено: ${ok}, без изменений: ${skipped}, ошибок: ${fail}`);
}

main();
