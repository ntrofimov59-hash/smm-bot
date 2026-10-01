#!/usr/bin/env node
// agent/supplier-bot-cli.js — запуск Telegram-бота поиска поставщиков.
//
// Использование:
//   node agent/supplier-bot-cli.js run [project-slug]
//
// Требуется:
//   SUPPLIER_BOT_TOKEN — токен от @BotFather
//   SUPPLIER_BOT_USERS — (опц.) список user_id через запятую, кому разрешено

import 'dotenv/config';
import path from 'path';
import { startSupplierBot } from './supplier-bot/index.js';

function projectPath(slug) {
  const root = process.env.PROJECTS_ROOT
    ? path.resolve(process.env.PROJECTS_ROOT)
    : path.resolve(new URL('../projects/', import.meta.url).pathname);
  return path.join(root, slug);
}

async function main() {
  const [cmd, slug] = process.argv.slice(2);
  const projectSlug = slug || process.env.SUPPLIER_BOT_DEFAULT_PROJECT || 'coucou-events';

  if (cmd !== 'run') {
    console.log(`supplier-bot-cli — команды:

  run [project-slug]   запустить бота (по умолчанию coucou-events)

ENV:
  SUPPLIER_BOT_TOKEN          — токен бота (от @BotFather)
  SUPPLIER_BOT_USERS          — (опц.) белый список user_id через запятую
  SUPPLIER_BOT_DEFAULT_PROJECT — (опц.) slug проекта по умолчанию

Создать бота: напиши @BotFather → /newbot → получи токен → добавь в .env
`);
    process.exit(cmd ? 1 : 0);
  }

  if (!process.env.SUPPLIER_BOT_TOKEN) {
    console.error('❌ SUPPLIER_BOT_TOKEN не задан в .env');
    console.error('   Создай бота: @BotFather → /newbot → скопируй токен');
    process.exit(1);
  }

  const p = projectPath(projectSlug);
  console.log(`🚀 Supplier bot для проекта: ${projectSlug}`);
  console.log(`   База: ${p}/suppliers/`);

  const bot = startSupplierBot({
    projectPath: p,
    onLog: (m) => console.log(m),
  });

  process.on('SIGINT', async () => {
    console.log('\n⏸  остановка...');
    await bot.stop();
    process.exit(0);
  });
}

main();
