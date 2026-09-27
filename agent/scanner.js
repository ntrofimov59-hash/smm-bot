// agent/scanner.js — сканирует inbox, обрабатывает фото, добавляет в очередь
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { analyzeImage } from './vision.js';
import { generateCaption } from './caption.js';
import { buildHashtags } from './hashtags.js';
import { processImage } from './image-processor.js';
import { pickBestMatches } from './matcher.js';
import { scheduleNext } from './planner.js';
import * as queue from './queue.js';
import { notifyScheduled } from './telegram.js';
import { loadProject, loadAccounts } from './config-loader.js';
import { pickLandmarkForVision, buildCaptionContext } from './locations.js';

const PUBLIC_MEDIA_DIR = process.env.MEDIA_DIR || '/var/www/smm-media';
const PUBLIC_MEDIA_URL = process.env.MEDIA_PUBLIC_URL || 'https://smm.coucou-events.com/media';

const SUPPORTED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export async function scanProject(projectPath, { dryRun = false } = {}) {
  const projectJsonPath = path.join(projectPath, 'project.json');
  const accountsJsonPath = path.join(projectPath, 'accounts.json');
  const inboxDir = path.join(projectPath, 'inbox');
  const processedDir = path.join(projectPath, 'processed');
  const scheduledDir = path.join(projectPath, 'scheduled');
  const failedDir = path.join(projectPath, 'failed');

  if (!fs.existsSync(projectJsonPath)) {
    console.warn(`⚠️ Нет project.json в ${projectPath}`);
    return { scanned: 0, processed: 0, failed: 0, scheduled: 0 };
  }

  // accounts.json может отсутствовать в чистом клоне (в .gitignore)
  // или в проекте, где ещё не настроены аккаунты. Не падаем — пропускаем.
  if (!fs.existsSync(accountsJsonPath)) {
    console.warn(`⚠️ Нет accounts.json в ${projectPath} — проект не настроен, пропускаю`);
    return { scanned: 0, processed: 0, failed: 0, scheduled: 0 };
  }

  const project = loadProject(projectPath);
  const accounts = loadAccounts(projectPath);
  if (!accounts) {
    console.warn(`⚠️ Нет accounts.json в ${projectPath} — проект не настроен, пропускаю`);
    return { scanned: 0, processed: 0, failed: 0, scheduled: 0 };
  }
  const projectSlug = project.slug;

  fs.mkdirSync(inboxDir, { recursive: true });
  fs.mkdirSync(processedDir, { recursive: true });
  fs.mkdirSync(scheduledDir, { recursive: true });
  fs.mkdirSync(failedDir, { recursive: true });
  fs.mkdirSync(path.join(PUBLIC_MEDIA_DIR, 'scheduled'), { recursive: true });
  fs.mkdirSync(path.join(PUBLIC_MEDIA_DIR, 'tmp'), { recursive: true });

  const files = fs.readdirSync(inboxDir).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return SUPPORTED_EXT.has(ext);
  });

  const stats = { scanned: files.length, processed: 0, failed: 0, scheduled: 0 };
  if (!files.length) return stats;

  console.log(`\n📂 ${projectSlug}: ${files.length} файлов в inbox`);

  const upcoming = queue.getUpcoming({ limit: 100 });
  const existingTimes = upcoming.map(i => new Date(i.scheduledAt).getTime());

  for (const file of files) {
    const inputPath = path.join(inboxDir, file);
    const fileBase = path.basename(file, path.extname(file));
    const hash = crypto.createHash('md5').update(fileBase + Date.now()).digest('hex').slice(0, 8);
    const scheduledFilename = `${Date.now()}-${hash}.jpg`;
    const scheduledPath = path.join(scheduledDir, scheduledFilename);

    console.log(`\n🖼  ${file}`);
    try {
      console.log('  1/6 vision…');
      const vision = await analyzeImage(inputPath);
      console.log(`     tags: [${vision.tags.join(', ')}]`);
      console.log(`     mood: ${vision.mood}`);

      const matches = pickBestMatches(vision.tags, accounts.instagram || [], { minScore: 0.3, maxResults: 10 });
      if (!matches.length) {
        console.log('  ❌ Не подошёл ни один аккаунт');
        moveToFailed(inputPath, failedDir, file, 'no matching accounts');
        stats.failed++;
        continue;
      }
      console.log(`  → аккаунты: ${matches.map(m => '@' + m.username).join(', ')}`);

      const service = inferService(vision.tags);
      const cityKey = matches[0]?.city || '';

      // Подбираем локацию по тегам vision (beach → пляж, nature → природа, ...)
      const landmark = cityKey
        ? pickLandmarkForVision(project, cityKey, vision.tags)
        : null;
      const locationContext = landmark
        ? buildCaptionContext(project, cityKey, { landmark })
        : '';
      if (landmark) {
        console.log(`  → локация: ${landmark.name} ${landmark.hashtag}`);
      }

      console.log('  2/6 caption…');
      const lang = project.languages?.[0] || 'ru';
      const { caption, hashtags: llmHashtags, tokens } = await generateCaption({
        description: vision.description,
        topics: vision.suggestedTopics,
        mood: vision.mood,
        city: cityKey,
        project,
        lang,
        service,
        locationContext,
      });
      console.log(`     tokens: ${tokens}`);

      console.log('  3/6 hashtags…');
      const finalHashtags = buildHashtags({
        project,
        city: cityKey,
        service,
        imageTags: vision.tags,
        llmHashtags,
        landmarkHashtag: landmark?.hashtag || null,
        max: project.publishing?.maxHashtags || 12,
      });

      console.log('  4/6 image processing…');
      const imgResult = await processImage(inputPath, scheduledPath, project.imageProcessing || {});
      console.log(`     ${imgResult.width}×${imgResult.height}, ${imgResult.sizeKB} KB`);

      const publicScheduledPath = path.join(PUBLIC_MEDIA_DIR, 'scheduled', scheduledFilename);
      fs.copyFileSync(scheduledPath, publicScheduledPath);
      const imageUrl = `${PUBLIC_MEDIA_URL}/scheduled/${scheduledFilename}`;
      console.log(`     public: ${imageUrl}`);

      const scheduledAt = scheduleNext({
        project,
        timezone: project.timezone,
        existing: existingTimes,
      });
      existingTimes.push(scheduledAt.getTime());

      if (dryRun) {
        console.log(`  🔎 DRY-RUN: ${scheduledAt.toISOString()}`);
        console.log(`     caption: ${caption.slice(0, 100)}…`);
        stats.processed++;
        continue;
      }

      const entry = queue.enqueue({
        scheduledAt: scheduledAt.toISOString(),
        projectSlug,
        projectPath,
        imagePath: scheduledPath,
        imageUrl,
        accounts: matches.map(m => ({
          username: m.username,
          igUserId: m.igUserId,
          accessToken: m.accessToken, // TODO: убрать после безопасного store
          city: m.city,
        })),
        caption,
        hashtags: finalHashtags,
        visionTags: vision.tags,
      });

      const processedPath = path.join(processedDir, file);
      fs.renameSync(inputPath, processedPath);

      console.log(`  ✅ Запланирован на ${scheduledAt.toISOString()} (id=${entry.id})`);
      stats.processed++;
      stats.scheduled++;
    } catch (e) {
      console.error(`  ❌ Ошибка: ${e.message}`);
      moveToFailed(inputPath, failedDir, file, e.message);
      stats.failed++;
    }
  }

  if (stats.scheduled > 0 && !dryRun) {
    const upcoming = queue.getUpcoming({ limit: 1 });
    const nextTime = upcoming[0]?.scheduledAt
      ? new Date(upcoming[0].scheduledAt).toLocaleString('ru-RU', { timeZone: project.timezone })
      : '—';
    await notifyScheduled({
      projectSlug,
      count: stats.scheduled,
      nextTime,
    });
  }

  return stats;
}

function moveToFailed(inputPath, failedDir, file, reason) {
  try {
    if (!fs.existsSync(inputPath)) return;
    const dest = path.join(failedDir, `${Date.now()}-${file}`);
    fs.renameSync(inputPath, dest);
    fs.writeFileSync(dest + '.error.txt', String(reason).slice(0, 1000));
    console.log(`  → перемещён в failed/`);
  } catch (e) {
    console.warn('  не удалось переместить в failed:', e.message);
  }
}

function inferService(tags) {
  if (tags.includes('tent') || tags.includes('marquee')) return 'tents';
  if (tags.includes('food') || tags.includes('table') || tags.includes('dessert')) return 'catering';
  if (tags.includes('couple') || tags.includes('ceremony') || tags.includes('flowers')) return 'wedding';
  if (tags.includes('party') || tags.includes('guests')) return 'corporate';
  return null;
}

export async function scanAllProjects({ dryRun = false } = {}) {
  const rootDir = process.env.PROJECTS_ROOT
    ? path.resolve(process.env.PROJECTS_ROOT)
    : path.resolve(new URL('../projects/', import.meta.url).pathname);
  if (!fs.existsSync(rootDir)) return {};

  const dirs = fs.readdirSync(rootDir).filter(d => fs.statSync(path.join(rootDir, d)).isDirectory());
  const results = {};

  for (const dir of dirs) {
    results[dir] = await scanProject(path.join(rootDir, dir), { dryRun });
  }

  return results;
}
