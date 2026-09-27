// cli.js — команды управления
import 'dotenv/config';
import { scanAllProjects } from './agent/scanner.js';
import * as queue from './agent/queue.js';
import * as usage from './agent/usage.js';

const cmd = process.argv[2] || 'help';

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

Основной процесс:
  node bot.js              — постоянный процесс с cron`);
  }
}

main().catch(e => {
  console.error('Ошибка:', e.message);
  process.exit(1);
});
