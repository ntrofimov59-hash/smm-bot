// bot.js — главный процесс-оркестратор:
//   SMM (scan + publish) + supplier-bot + outreach ticks + ingest + health
import 'dotenv/config';
import { pathToFileURL } from 'url';
import cron from 'node-cron';
import { scanAllProjects } from './agent/scanner.js';
import { tick as schedulerTick } from './agent/scheduler.js';
import * as queue from './agent/queue.js';
import { notify } from './agent/telegram.js';
import { startHealthServer, stopHealthServer } from './agent/health.js';
import { startIngestBot } from './agent/telegram-ingest.js';
import { main as refreshMain } from './agent/refresh-tokens.js';
import {
  startSideModules,
  stopSideModules,
  getModuleFlags,
  modulesStartupText,
} from './agent/orchestrator.js';

function envOn(name, defaultOn = true) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultOn;
  return !['0', 'false', 'off', 'no'].includes(String(v).toLowerCase());
}

export async function main() {
  const SCAN_EVERY_MINUTES = Number(process.env.SCAN_INTERVAL_MIN) || 15;
  const SCHEDULER_EVERY_MINUTES = Number(process.env.SCHEDULER_INTERVAL_MIN) || 1;
  const enableSmm = envOn('ENABLE_SMM', true);

  console.log('🤖 SMM Bot (orchestrator) запускается...');
  if (enableSmm) {
    console.log(`   Сканирование inbox: каждые ${SCAN_EVERY_MINUTES} мин`);
    console.log(`   Проверка очереди: каждые ${SCHEDULER_EVERY_MINUTES} мин`);
  } else {
    console.log('   SMM отключён (ENABLE_SMM=0)');
  }

  const jobs = [];

  if (enableSmm) {
    try {
      console.log('\n🔍 Первичное сканирование...');
      const r = await scanAllProjects();
      for (const [slug, stats] of Object.entries(r)) {
        console.log(`   ${slug}: scanned=${stats.scanned} scheduled=${stats.scheduled} failed=${stats.failed}`);
      }
    } catch (e) {
      console.error('Ошибка первичного скана:', e.message);
    }

    jobs.push(cron.schedule(`*/${SCAN_EVERY_MINUTES} * * * *`, async () => {
      try {
        console.log(`\n🔍 [${new Date().toISOString()}] Сканирую inbox...`);
        await scanAllProjects();
      } catch (e) {
        console.error('scan error:', e.message);
      }
    }));

    jobs.push(cron.schedule(`*/${SCHEDULER_EVERY_MINUTES} * * * *`, async () => {
      try {
        await schedulerTick();
      } catch (e) {
        console.error('scheduler error:', e.message);
      }
    }));

    jobs.push(cron.schedule('0 4 * * *', () => {
      queue.cleanupOld({ daysToKeep: 30 });
    }));

    jobs.push(cron.schedule('0 3 * * 0', async () => {
      try {
        console.log('\n🔐 [cron] Автообновление Instagram токенов...');
        await refreshMain();
      } catch (e) {
        console.error('refresh-tokens error:', e.message);
      }
    }));
  }

  const side = startSideModules({ onLog: console.log });

  let ingest = null;
  if (process.env.TELEGRAM_INGEST_BOT_TOKEN) {
    try {
      ingest = startIngestBot({ onLog: console.log });
    } catch (e) {
      console.error('ingest bot failed:', e.message);
    }
  } else {
    console.log('ℹ️  TELEGRAM_INGEST_BOT_TOKEN не задан — ingest bot не запущен');
  }

  const flags = getModuleFlags();
  let stats = { pending: 0, published: 0, failed: 0 };
  try {
    stats = queue.getStats();
  } catch {}

  await notify(`🤖 <b>Orchestrator запущен</b>

${modulesStartupText(flags)}

📊 Очередь: pending=${stats.pending}, published=${stats.published}, failed=${stats.failed}
⏱ Scan: ${enableSmm ? `каждые ${SCAN_EVERY_MINUTES} мин` : 'off'}`);

  try {
    await startHealthServer();
  } catch (e) {
    console.error('health server failed:', e.message);
  }

  console.log('\n✅ Orchestrator запущен');
  return { jobs, ingest, side, flags };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let app = null;

  const shutdown = async (signal) => {
    console.log(`\n🛑 ${signal} — останавливаюсь...`);
    try { if (app?.ingest) await app.ingest.stop(); } catch (e) { console.warn('ingest stop:', e.message); }
    try { await stopSideModules(app?.side); } catch (e) { console.warn('side stop:', e.message); }
    try { await stopHealthServer(); } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  app = await main().catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
  });
}
