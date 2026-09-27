// bot.js — главный процесс: сканирует inbox + публикует по расписанию
import 'dotenv/config';
import { pathToFileURL } from 'url';
import cron from 'node-cron';
import { scanAllProjects } from './agent/scanner.js';
import { tick as schedulerTick } from './agent/scheduler.js';
import * as queue from './agent/queue.js';
import { notify } from './agent/telegram.js';
import { startHealthServer, stopHealthServer } from './agent/health.js';

export async function main() {
  // Env читаем внутри функции — для тестируемости через vi.stubEnv
  // Number(x) || default — защита от NaN, если в .env опечатка ('abc')
  const SCAN_EVERY_MINUTES = Number(process.env.SCAN_INTERVAL_MIN) || 15;
  const SCHEDULER_EVERY_MINUTES = Number(process.env.SCHEDULER_INTERVAL_MIN) || 1;

  console.log('🤖 SMM Bot запускается...');
  console.log(`   Сканирование inbox: каждые ${SCAN_EVERY_MINUTES} мин`);
  console.log(`   Проверка очереди: каждые ${SCHEDULER_EVERY_MINUTES} мин`);

  // Первый прогон — не роняем процесс, если упадёт
  try {
    console.log('\n🔍 Первичное сканирование...');
    const r = await scanAllProjects();
    for (const [slug, stats] of Object.entries(r)) {
      console.log(`   ${slug}: scanned=${stats.scanned} scheduled=${stats.scheduled} failed=${stats.failed}`);
    }
  } catch (e) {
    console.error('Ошибка первичного скана:', e.message);
  }

  const jobs = [];

  // Cron: сканирование inbox
  jobs.push(cron.schedule(`*/${SCAN_EVERY_MINUTES} * * * *`, async () => {
    try {
      console.log(`\n🔍 [${new Date().toISOString()}] Сканирую inbox...`);
      await scanAllProjects();
    } catch (e) {
      console.error('scan error:', e.message);
    }
  }));

  // Cron: публикация
  jobs.push(cron.schedule(`*/${SCHEDULER_EVERY_MINUTES} * * * *`, async () => {
    try {
      await schedulerTick();
    } catch (e) {
      console.error('scheduler error:', e.message);
    }
  }));

  // Cron: очистка старых записей в 4:00
  jobs.push(cron.schedule('0 4 * * *', () => {
    queue.cleanupOld({ daysToKeep: 30 });
  }));

  const stats = queue.getStats();
  await notify(`🤖 <b>SMM Bot запущен</b>

📊 Очередь: pending=${stats.pending}, published=${stats.published}, failed=${stats.failed}
⏱ Сканирование: каждые ${SCAN_EVERY_MINUTES} мин`);

  // HTTP-сервер для healthcheck и мониторинга
  try {
    await startHealthServer();
  } catch (e) {
    console.error('health server failed:', e.message);
  }

  console.log('\n✅ SMM Bot запущен');
  return jobs;
}

// Запускаем только при прямом вызове (node bot.js), не при импорте из тестов
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const shutdown = async (signal) => {
    console.log(`\n🛑 ${signal} — останавливаюсь...`);
    try { await stopHealthServer(); } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
  });
}
