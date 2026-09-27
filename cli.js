// cli.js — команды управления
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { scanAllProjects } from './agent/scanner.js';
import * as queue from './agent/queue.js';
import * as usage from './agent/usage.js';
import * as sources from './agent/sources/index.js';
import { getQueueInfo, migrateJsonToSqlite } from './agent/queue-migrate.js';

const cmd = process.argv[2] || 'help';

/**
 * Парсит флаги после позиционного аргумента.
 * Возвращает { positional: [...], flags: { ... } }
 */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function main() {
  switch (cmd) {
    case 'status': {
      const stats = queue.getStats();
      const u = usage.getStatus();
      const upcoming = queue.getUpcoming({ limit: 5 });

      console.log('📊 Состояние SMM Bot\n');
      console.log('Очередь:');
      console.log(`  ⏳ pending:   ${stats.pending}`);
      console.log(`  📤 publishing: ${stats.publishing}`);
      console.log(`  ✅ published:  ${stats.published}`);
      console.log(`  ❌ failed:     ${stats.failed}`);
      console.log(`  📦 всего:      ${stats.total}`);

      console.log('\nИспользование API (сегодня):');
      console.log(`  🎯 Gemini: ${u.today.gemini_requests}/${u.limits.gemini_requests_day} (${u.today.gemini_requests_pct}%)`);
      console.log(`  🧠 Groq:   ${u.today.groq_tokens} токенов (${u.today.groq_tokens_pct}%)`);
      console.log(`  📸 постов: ${u.today.posts}/${u.limits.posts_day} (${u.today.posts_pct}%)`);
      console.log(`  💾 cache hits: ${u.today.cache_hits}`);

      if (upcoming.length) {
        console.log('\nБлижайшие посты:');
        for (const i of upcoming) {
          const t = new Date(i.scheduledAt).toLocaleString('ru-RU');
          console.log(`  • ${t} — ${i.projectSlug} (${i.accounts.length} акк.)`);
        }
      }
      break;
    }

    case 'scan': {
      const dryRun = process.argv.includes('--dry');
      console.log(`🔍 Сканирую все проекты${dryRun ? ' (dry-run)' : ''}...\n`);
      const results = await scanAllProjects({ dryRun });
      for (const [slug, stats] of Object.entries(results)) {
        console.log(`\n📦 ${slug}:`);
        console.log(`   scanned:   ${stats.scanned}`);
        console.log(`   processed: ${stats.processed}`);
        console.log(`   scheduled: ${stats.scheduled}`);
        console.log(`   failed:    ${stats.failed}`);
      }
      break;
    }

    case 'fetch': {
      const { positional, flags } = parseArgs(process.argv.slice(3));
      const source = positional[0];

      if (!source) {
        console.log('Использование: node cli.js fetch <source> [args] --project <slug> [--limit N]');
        console.log('  source: pinterest | instagram-graph | instagram-user');
        console.log('  pinterest:        node cli.js fetch pinterest <board-url> --project <slug> [--limit N]');
        console.log('  instagram-graph:  node cli.js fetch instagram-graph --project <slug> [--limit N]');
        console.log('  instagram-user:   node cli.js fetch instagram-user --ig-user-id <id> --project <slug> [--limit N]');
        break;
      }

      const projectSlug = flags.project;
      if (!projectSlug) {
        console.error('❌ Нужен --project <slug>');
        process.exit(1);
      }

      const projectDir = path.resolve('projects', projectSlug);
      if (!fs.existsSync(projectDir)) {
        console.error(`❌ Проект не найден: ${projectDir}`);
        process.exit(1);
      }

      const inboxDir = path.join(projectDir, 'inbox');
      fs.mkdirSync(inboxDir, { recursive: true });

      const limit = flags.limit ? Number(flags.limit) : 20;
      const params = {};

      if (source === 'pinterest') {
        params.boardUrl = positional[1];
        if (!params.boardUrl) {
          console.error('❌ Нужен board URL');
          process.exit(1);
        }
      } else if (source === 'instagram-graph') {
        const accountsFile = path.join(projectDir, 'accounts.json');
        const accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
        const acc = (accounts.instagram || []).find(a => a.active && a.accessToken);
        if (!acc) {
          console.error('❌ Нет активного Instagram-аккаунта с accessToken в accounts.json');
          process.exit(1);
        }
        params.accessToken = acc.accessToken;
      } else if (source === 'instagram-user') {
        const accountsFile = path.join(projectDir, 'accounts.json');
        const accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
        const igUserId = flags['ig-user-id'];
        if (!igUserId) {
          console.error('❌ Нужен --ig-user-id <id>');
          process.exit(1);
        }
        const acc = (accounts.instagram || []).find(a => a.igUserId === igUserId);
        if (!acc?.accessToken) {
          console.error(`❌ Аккаунт с igUserId=${igUserId} не найден или без accessToken`);
          process.exit(1);
        }
        params.accessToken = acc.accessToken;
        params.igUserId = igUserId;
      } else {
        console.error(`❌ Неизвестный source: ${source}`);
        process.exit(1);
      }

      console.log(`📥 Fetch ${source} → ${inboxDir} (limit=${limit})...\n`);
      const r = await sources.fetchAndSave(source, params, inboxDir, {
        limit,
        onProgress: (item) => console.log(`  ✓ ${item.filename} (${item.sizeKB} KB)`),
      });

      console.log(`\n✅ Готово:`);
      console.log(`  Скачано: ${r.downloaded.length}`);
      console.log(`  Ошибок:  ${r.failed.length}`);
      if (r.failed.length) {
        for (const f of r.failed) console.log(`    ✗ ${f.imageUrl}: ${f.error}`);
      }
      break;
    }

    case 'queue': {
      const sub = process.argv[3] || 'info';
      if (sub === 'info') {
        const info = getQueueInfo();
        console.log(`🗄  Backend: ${info.backend}`);
        console.log(`   Path:    ${info.path}`);
        console.log(`   Exists:  ${info.exists}`);
        if (info.exists) {
          console.log(`   Size:    ${(info.sizeBytes / 1024).toFixed(1)} KB`);
          if (info.count !== null) console.log(`   Items:   ${info.count}`);
        }
      } else if (sub === 'migrate') {
        const deleteOld = process.argv.includes('--delete-old');
        console.log('📦 Миграция JSON → SQLite...\n');
        const r = await migrateJsonToSqlite({ deleteOld });
        console.log(`   Всего:    ${r.total}`);
        console.log(`   Перенесено: ${r.migrated}`);
        console.log(`   Пропущено:  ${r.skipped}`);
        if (r.deletedOld) console.log(`   queue.json → queue.json.migrated`);
      } else {
        console.log('Использование:');
        console.log('  node cli.js queue info');
        console.log('  node cli.js queue migrate [--delete-old]');
      }
      break;
    }

    case 'upcoming': {
      const items = queue.getUpcoming({ limit: 20 });
      console.log(`📅 ${items.length} постов в очереди:\n`);
      for (const i of items) {
        const t = new Date(i.scheduledAt).toLocaleString('ru-RU');
        console.log(`  ${t} | ${i.projectSlug} | ${i.accounts.map(a => '@' + a.username).join(', ')}`);
        console.log(`    ${(i.caption || '').slice(0, 80)}…`);
        console.log('');
      }
      break;
    }

    case 'publish-now': {
      const id = process.argv[3];
      if (!id) {
        console.log('Использование: node cli.js publish-now <queueItemId>');
        break;
      }
      queue.updateItem(id, { scheduledAt: new Date(Date.now() - 1000).toISOString() });
      console.log(`⚡ ${id} помечен для немедленной публикации`);
      break;
    }

    case 'help':
    default:
      console.log(`SMM Bot CLI

Команды:
  node cli.js status       — состояние очереди и лимитов
  node cli.js scan         — сканировать inbox всех проектов
  node cli.js scan --dry   — только показать, что будет сделано
  node cli.js upcoming     — ближайшие запланированные посты
  node cli.js publish-now <id> — публиковать немедленно

Очередь:
  node cli.js queue info              — активный бэкенд и путь
  node cli.js queue migrate           — перенести JSON → SQLite
  node cli.js queue migrate --delete-old  — и переименовать старый файл

Fetching:
  node cli.js fetch pinterest <board-url> --project <slug> [--limit N]
  node cli.js fetch instagram-graph --project <slug> [--limit N]
  node cli.js fetch instagram-user --ig-user-id <id> --project <slug> [--limit N]

Основной процесс:
  node bot.js              — постоянный процесс с cron`);
  }
}

main().catch(e => {
  console.error('Ошибка:', e.message);
  process.exit(1);
});
