// agent/orchestrator.js — единый runtime: SMM + supplier-bot + outreach ticks
// Подсистемы включаются флагами env и наличием токенов. Падение одной не роняет процесс.

import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { startSupplierBot } from './supplier-bot/index.js';
import * as store from './outreach/store.js';
import { getPendingFollowups, getStuckCandidates } from './outreach/reminders.js';
import { rankCandidates } from './outreach/ranker.js';
import { notifyDailySummary } from './outreach/notifier.js';
import { notify as _notify } from './telegram.js';

function projectsRoot() {
  if (process.env.PROJECTS_ROOT) return path.resolve(process.env.PROJECTS_ROOT);
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'projects');
}

function listProjectSlugs() {
  const root = projectsRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((d) => {
    try {
      return fs.statSync(path.join(root, d)).isDirectory()
        && fs.existsSync(path.join(root, d, 'project.json'));
    } catch {
      return false;
    }
  });
}

function projectPath(slug) {
  return path.join(projectsRoot(), slug);
}

function envFlag(name, defaultOn = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultOn;
  return !['0', 'false', 'off', 'no'].includes(String(v).toLowerCase());
}

/**
 * Снимок включённых подсистем (для логов и /status).
 */
export function getModuleFlags() {
  return {
    smm: envFlag('ENABLE_SMM', true),
    supplier: envFlag('ENABLE_SUPPLIER_BOT', true) && Boolean(process.env.SUPPLIER_BOT_TOKEN),
    outreach: envFlag('ENABLE_OUTREACH', true),
    ingest: Boolean(process.env.TELEGRAM_INGEST_BOT_TOKEN),
  };
}

/**
 * Один tick outreach по всем проектам: follow-up + stuck + топ found.
 * Не отправляет сообщения кандидатам — только сводку тебе в Telegram.
 */
export async function outreachTick({ onLog = console.log } = {}) {
  const slugs = listProjectSlugs();
  if (!slugs.length) {
    onLog('outreach tick: нет проектов');
    return { projects: 0 };
  }

  let totalFollowups = 0;
  let totalStuck = 0;
  let notified = 0;

  for (const slug of slugs) {
    const p = projectPath(slug);
    let candidates;
    try {
      candidates = store.listCandidates(p);
    } catch (e) {
      onLog(`outreach tick ${slug}: store error — ${e.message}`);
      continue;
    }
    if (!candidates.length) continue;

    const followups = getPendingFollowups(candidates);
    const stuck = getStuckCandidates(candidates);
    const found = candidates.filter((c) => c.status === 'found');
    const top = rankCandidates(found).slice(0, 5);

    // Новые за сегодня (createdAt)
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const newCount = candidates.filter((c) => {
      if (!c.createdAt) return false;
      return new Date(c.createdAt).getTime() >= dayStart.getTime();
    }).length;

    totalFollowups += followups.length;
    totalStuck += stuck.length;

    if (!followups.length && !stuck.length && !top.length && newCount === 0) continue;

    try {
      const r = await notifyDailySummary({
        projectSlug: slug,
        newCount,
        pendingFollowups: followups,
        topCandidates: top,
      });
      if (r.ok) notified++;
      else onLog(`outreach notify ${slug}: ${r.error || 'fail'}`);
    } catch (e) {
      onLog(`outreach notify ${slug}: ${e.message}`);
    }
  }

  onLog(`outreach tick: projects=${slugs.length} followups=${totalFollowups} stuck=${totalStuck} notified=${notified}`);
  return { projects: slugs.length, totalFollowups, totalStuck, notified };
}

/**
 * Запускает фоновые подсистемы поверх уже работающих SMM-cron'ов.
 * @returns {{ supplier: object|null, outreachJobs: import('node-cron').ScheduledTask[], flags: object }}
 */
export function startSideModules({ onLog = console.log } = {}) {
  const flags = getModuleFlags();
  const outreachJobs = [];
  let supplier = null;

  onLog(`📦 Модули: smm=${flags.smm ? 'on' : 'off'} supplier=${flags.supplier ? 'on' : 'off'} outreach=${flags.outreach ? 'on' : 'off'} ingest=${flags.ingest ? 'on' : 'off'}`);

  // ── Supplier Telegram bot ──────────────────────────────────────────
  if (flags.supplier) {
    const slug = process.env.SUPPLIER_BOT_DEFAULT_PROJECT || 'coucou-events';
    const p = projectPath(slug);
    try {
      supplier = startSupplierBot({ projectPath: p, onLog });
      onLog(`🔍 Supplier bot: проект ${slug} (${p}/suppliers/)`);
    } catch (e) {
      onLog(`supplier bot failed: ${e.message}`);
      supplier = null;
    }
  } else if (envFlag('ENABLE_SUPPLIER_BOT', true) && !process.env.SUPPLIER_BOT_TOKEN) {
    onLog('ℹ️  SUPPLIER_BOT_TOKEN не задан — supplier bot не запущен');
  }

  // ── Outreach: daily summary + follow-up reminders ──────────────────
  if (flags.outreach) {
    const cronExpr = process.env.OUTREACH_SUMMARY_CRON || '0 9 * * *'; // 09:00 каждый день
    try {
      const job = cron.schedule(cronExpr, async () => {
        try {
          onLog(`\n🤝 [${new Date().toISOString()}] Outreach daily tick...`);
          await outreachTick({ onLog });
        } catch (e) {
          onLog(`outreach tick error: ${e.message}`);
        }
      });
      outreachJobs.push(job);
      onLog(`🤝 Outreach tick: cron «${cronExpr}»`);
    } catch (e) {
      onLog(`outreach cron invalid («${process.env.OUTREACH_SUMMARY_CRON}»): ${e.message}`);
    }

    // Опциональный первый прогон при старте (не спамим, только если явно включено)
    if (envFlag('OUTREACH_TICK_ON_START', false)) {
      setTimeout(() => {
        outreachTick({ onLog }).catch((e) => onLog(`outreach start tick: ${e.message}`));
      }, 15_000);
    }
  }

  return { supplier, outreachJobs, flags };
}

/**
 * Корректная остановка side-модулей.
 */
export async function stopSideModules(side, { onLog = console.log } = {}) {
  if (!side) return;
  if (side.supplier?.stop) {
    try {
      await side.supplier.stop();
      onLog('supplier bot stopped');
    } catch (e) {
      onLog(`supplier stop: ${e.message}`);
    }
  }
  for (const job of side.outreachJobs || []) {
    try {
      job.stop();
    } catch {}
  }
}

/**
 * Короткий текст для notify при старте.
 */
export function modulesStartupText(flags) {
  const lines = [
    `SMM: ${flags.smm ? '✅' : '⏸'}`,
    `Supplier: ${flags.supplier ? '✅' : '⏸'}`,
    `Outreach: ${flags.outreach ? '✅' : '⏸'}`,
    `Ingest: ${flags.ingest ? '✅' : '⏸'}`,
  ];
  return lines.join(' · ');
}

export { listProjectSlugs, projectPath, projectsRoot };
