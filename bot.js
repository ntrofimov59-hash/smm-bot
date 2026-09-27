// bot.js — главный процесс: сканирует inbox + публикует по расписанию
import 'dotenv/config';
import cron from 'node-cron';
import { scanAllProjects } from './agent/scanner.js';
import { tick as schedulerTick } from './agent/scheduler.js';
import * as queue from './agent/queue.js';
import { notify } from './agent/telegram.js';

const SCAN_EVERY_MINUTES = Number(process.env.SCAN_INTERVAL_MIN || 15);
const SCHEDULER_EVERY_MINUTES = Number(process.env.SCHEDULER_INTERVAL_MIN || 1);

async function main() {
  console.log('🤖 SMM Bot запускается...');
  console.log(`   Сканирование inbox: каждые ${SCAN_EVERY_MINUTES} мин`);
  console.log(`   Проверка очереди: каждые ${SCHEDULER_EVERY_MINUTES} мин`);

  // Первый прогон сразу
  try {
    console.log('\n🔍 Первичное сканирование...');
    const r = await scanAllProjects();
    for (const [slug, stats] of Object.entries(r)) {
      console.log(`   ${slug}: scanned=${stats.scanned} scheduled=${stats.scheduled} failed=${stats.failed}`);
    }
  } catch (e) {
    console.error('Ошибка первичного скана:', e.message);
  }

  // Cron: сканирование inbox
  cron.schedule(`*/${SCAN_EVERY_MINUTES} * * * *`, async () => {
    try {
      console.log(`\n🔍 [${new Date().toISOString()}] Сканирую inbox...`);
      await scanAllProjects();
    } catch (e) {
      console.error('scan error:', e.message);
    }
  });

  // Cron: публикация (каждую минуту)
  cron.schedule(`*/${SCHEDULER_EVERY_MINUTES} * * * *`, async () => {
    try {
      await schedulerTick();
    } catch (e) {
      console.error('scheduler error:', e.message);
    }
  });

  // Cron: очистка старых записей раз в день
  cron.schedule('0 4 * * *', () => {
    queue.cleanupOld({ daysToKeep: 30 });
  });

  const stats = queue.getStats();
  await notify(`🤖 <b>SMM Bot запущен</b>

📊 Очередь: pending=${stats.pending}, published=${stats.published}, failed=${stats.failed}
⏱ Сканирование: каждые ${SCAN_EVERY_MINUTES} мин`);

  console.log('\n✅ SMM Bot запущен');
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
