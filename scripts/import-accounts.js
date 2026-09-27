#!/usr/bin/env node
// scripts/import-accounts.js — импорт новых Instagram-аккаунтов.
//
// Использование:
//   1. Создай /tmp/new-tokens.txt со строками: <city>:<accessToken>
//   2. node scripts/import-accounts.js
//   3. Скрипт валидирует токены через /me, добавляет в accounts.json,
//      удаляет /tmp/new-tokens.txt
//
// Безопасность:
//   - токены не выводятся в stdout
//   - файл удаляется в конце (в том числе при ошибке)
//   - accounts.json — в .gitignore, не коммитится

import fs from 'fs';
import path from 'path';

const TOKENS_FILE = '/tmp/new-tokens.txt';
const ACCOUNTS_FILE = path.resolve('projects/coucou-events/accounts.json');
const API = 'https://graph.instagram.com/v23.0';

// city → cityTags (для матчинга фото)
const CITY_TAGS = {
  yerevan:    ['city', 'architecture', 'culture', 'mountains', 'sunset', 'nature'],
  casablanca: ['city', 'architecture', 'ocean', 'beach', 'sunset', 'culture'],
  bali:       ['beach', 'tropical', 'ocean', 'nature', 'sunset', 'temple'],
  danang:     ['beach', 'tropical', 'ocean', 'bridge', 'city', 'sunset', 'nature'],
};

async function whoAmI(token) {
  const url = `${API}/me?fields=id,username,account_type&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `HTTP ${res.status}`);
  }
  return { igUserId: data.id, username: data.username, accountType: data.account_type };
}

async function main() {
  if (!fs.existsSync(TOKENS_FILE)) {
    console.error(`❌ Файл ${TOKENS_FILE} не найден. Создай его через nano: <city>:<token>`);
    process.exit(1);
  }

  const lines = fs.readFileSync(TOKENS_FILE, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  if (!lines.length) {
    console.error('❌ Файл пуст');
    fs.unlinkSync(TOKENS_FILE);
    process.exit(1);
  }

  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  const existingUsernames = new Set((accounts.instagram || []).map(a => a.username));

  let added = 0, skipped = 0, failed = 0;

  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) {
      console.error(`❌ Некорректная строка (нет ":"): ${line.slice(0, 20)}…`);
      failed++;
      continue;
    }
    const city = line.slice(0, idx).trim().toLowerCase();
    const token = line.slice(idx + 1).trim();

    process.stdout.write(`🔍 ${city.padEnd(12)} … `);

    try {
      const me = await whoAmI(token);

      if (existingUsernames.has(me.username)) {
        console.log(`⏭  ${me.username} уже есть в accounts.json — пропускаю`);
        skipped++;
        continue;
      }

      const cityTags = CITY_TAGS[city] || [];
      accounts.instagram.push({
        username: me.username,
        igUserId: me.igUserId,
        accessToken: token,
        city,
        cityTags,
        active: true,
        refreshedAt: new Date().toISOString(),
        expiresIn: 5184000,
      });
      existingUsernames.add(me.username);
      console.log(`✅ ${me.username} (igUserId=${me.igUserId}, type=${me.accountType})`);
      added++;
    } catch (e) {
      console.log(`❌ ${e.message}`);
      failed++;
    }
  }

  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  fs.unlinkSync(TOKENS_FILE);

  console.log('');
  console.log(`📊 Добавлено: ${added}, пропущено: ${skipped}, ошибок: ${failed}`);
  console.log(`💾 ${ACCOUNTS_FILE} обновлён`);
  console.log(`🗑  ${TOKENS_FILE} удалён`);
  console.log('');
  console.log(`Всего аккаунтов: ${accounts.instagram.length}`);
}

main().catch(e => {
  console.error('FATAL:', e);
  try { if (fs.existsSync(TOKENS_FILE)) fs.unlinkSync(TOKENS_FILE); } catch {}
  process.exit(1);
});
