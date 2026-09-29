// agent/scanner.js — сканирует inbox, обрабатывает фото, добавляет в очередь
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { analyzeImage } from './vision.js';
import { generateCaption } from './caption.js';
import { buildHashtags } from './hashtags.js';
import { processImage } from './image-processor.js';
import { processVideo, extractFrame } from './video-processor.js';
import { pickBestMatches } from './matcher.js';
import { scheduleNext } from './planner.js';
import * as queue from './queue.js';
import { notifyScheduled } from './telegram.js';
import { loadProject, loadAccounts } from './config-loader.js';
import { pickLandmarkForVision, buildCaptionContext } from './locations.js';

const PUBLIC_MEDIA_DIR = process.env.MEDIA_DIR || '/var/www/smm-media';
const PUBLIC_MEDIA_URL = process.env.MEDIA_PUBLIC_URL || 'https://smm.coucou-events.com/media';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.avi', '.mkv']);

function mediaTypeForFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'IMAGE';
  if (VIDEO_EXT.has(ext)) return 'REELS';
  return null;
}

export async function scanProject(projectPath, { dryRun = false } = {}) {
  const projectJsonPath = path.join(projectPath, 'project.json');
  const accountsJsonPath = path.join(projectPath, 'accounts.json');
  const inboxDir = path.join(projectPath, 'inbox');
  const inboxStoriesDir = path.join(projectPath, 'inbox-stories');
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
  fs.mkdirSync(inboxStoriesDir, { recursive: true });
  fs.mkdirSync(processedDir, { recursive: true });
  fs.mkdirSync(scheduledDir, { recursive: true });
  fs.mkdirSync(failedDir, { recursive: true });
  fs.mkdirSync(path.join(PUBLIC_MEDIA_DIR, 'scheduled'), { recursive: true });
  fs.mkdirSync(path.join(PUBLIC_MEDIA_DIR, 'tmp'), { recursive: true });

  const filesFromInbox = fs.readdirSync(inboxDir)
    .filter(f => mediaTypeForFile(f) !== null)
    .map(f => ({ dir: inboxDir, file: f, sourceKind: 'inbox' }));
  const filesFromStories = fs.existsSync(inboxStoriesDir)
    ? fs.readdirSync(inboxStoriesDir)
        .filter(f => mediaTypeForFile(f) !== null)
        .map(f => ({ dir: inboxStoriesDir, file: f, sourceKind: 'stories' }))
    : [];
  const files = [...filesFromInbox, ...filesFromStories];

  const stats = { scanned: files.length, processed: 0, failed: 0, scheduled: 0 };
  if (!files.length) return stats;

  console.log(`\n📂 ${projectSlug}: ${files.length} файлов в inbox`);

  const upcoming = queue.getUpcoming({ limit: 100 });
  const existingTimes = upcoming.map(i => new Date(i.scheduledAt).getTime());

  for (const item of files) {
    const { dir: sourceDir, file, sourceKind } = item;
    const inputPath = path.join(sourceDir, file);
    const fileBase = path.basename(file, path.extname(file));
    const hash = crypto.createHash('md5').update(fileBase + Date.now()).digest('hex').slice(0, 8);
    const mediaType = sourceKind === 'stories' ? 'STORIES' : mediaTypeForFile(file);
    const scheduledExt = mediaType === 'REELS' ? '.mp4' : '.jpg';
    const scheduledFilename = `${Date.now()}-${hash}${scheduledExt}`;
    const scheduledPath = path.join(scheduledDir, scheduledFilename);

    const icon = mediaType === 'REELS' ? '🎬' : (mediaType === 'STORIES' ? '📸' : '🖼 ');
    const dirTag = sourceKind === 'stories' ? 'inbox-stories/' : 'inbox/';
    console.log(`\n${icon} ${dirTag}${file} [${mediaType}]`);
    try {
      // Для видео — извлекаем кадр и анализируем его (vision по видео не работает).
      // Кадр кладём в OS-temp, чтобы он не попал в inbox при следующем скане.
      let visionSourcePath = inputPath;
      let frameTmpPath = null;
      if (mediaType === 'REELS') {
        frameTmpPath = path.join(os.tmpdir(), `smm-frame-${hash}-${Date.now()}.jpg`);
        const fr = await extractFrame(inputPath, frameTmpPath, 1);
        if (fr.ok) {
          visionSourcePath = frameTmpPath;
        } else {
          console.warn(`  ⚠️ не удалось извлечь кадр: ${fr.error}`);
        }
      }

      console.log('  1/6 vision…');
      const vision = await analyzeImage(visionSourcePath);
      if (frameTmpPath) { try { fs.unlinkSync(frameTmpPath); } catch {} }
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

      let imageUrl = null;
      let videoUrl = null;
      let videoCoverUrl = null;

      if (mediaType === 'REELS') {
        console.log('  4/6 video processing…');
        const watermarkPath = path.join(projectPath, 'assets', 'logo-white.png');
        const vidResult = await processVideo({
          inputPath,
          outputPath: scheduledPath,
          settings: project.publishing?.video || {},
          watermarkPath: fs.existsSync(watermarkPath) ? watermarkPath : null,
        });
        if (!vidResult.ok) {
          throw new Error(`processVideo: ${vidResult.error}`);
        }
        console.log(`     ${vidResult.width}×${vidResult.height}, ${vidResult.durationSec}s, ${vidResult.sizeKB} KB`);

        // Обложка — кадр из уже обработанного видео
        const coverFilename = `${Date.now()}-${hash}-cover.jpg`;
        const coverLocalPath = path.join(scheduledDir, coverFilename);
        const frameResult = await extractFrame(scheduledPath, coverLocalPath, 1);
        if (frameResult.ok) {
          const coverPublicPath = path.join(PUBLIC_MEDIA_DIR, 'scheduled', coverFilename);
          fs.copyFileSync(coverLocalPath, coverPublicPath);
          videoCoverUrl = `${PUBLIC_MEDIA_URL}/scheduled/${coverFilename}`;
        }

        const publicVideoPath = path.join(PUBLIC_MEDIA_DIR, 'scheduled', scheduledFilename);
        fs.copyFileSync(scheduledPath, publicVideoPath);
        videoUrl = `${PUBLIC_MEDIA_URL}/scheduled/${scheduledFilename}`;
        console.log(`     public: ${videoUrl}`);
      } else {
        console.log('  4/6 image processing…');
        const imgResult = await processImage(inputPath, scheduledPath, project.imageProcessing || {});
        console.log(`     ${imgResult.width}×${imgResult.height}, ${imgResult.sizeKB} KB`);

        const publicScheduledPath = path.join(PUBLIC_MEDIA_DIR, 'scheduled', scheduledFilename);
        fs.copyFileSync(scheduledPath, publicScheduledPath);
        imageUrl = `${PUBLIC_MEDIA_URL}/scheduled/${scheduledFilename}`;
        console.log(`     public: ${imageUrl}`);
      }

      // Один queue-item НА КАЖДЫЙ аккаунт — со своим временем.
      // Это даёт «человеческое» поведение: аккаунты разных городов публикуют в разное время.
      const planned = [];

      for (const acc of matches) {
        const cityKey = acc.city || null;
        const scheduledAt = scheduleNext({
          project,
          timezone: project.timezone,
          city: cityKey,
          mediaType,
          existing: existingTimes,
        });
        existingTimes.push(scheduledAt.getTime());

        if (dryRun) {
          const cityLocal = cityKey
            ? scheduledAt.toLocaleString('ru-RU', {
                timeZone: project.citySchedules?.[cityKey]?.timezone || project.timezone,
                hour: '2-digit', minute: '2-digit', hour12: false,
              })
            : scheduledAt.toISOString();
          console.log(`  🔎 DRY-RUN @${acc.username}${cityKey ? ' (' + cityKey + ')' : ''}: ${cityLocal}`);
          continue;
        }

        const entry = queue.enqueue({
          scheduledAt: scheduledAt.toISOString(),
          projectSlug,
          projectPath,
          mediaType,
          imagePath: mediaType === 'IMAGE' ? scheduledPath : null,
          imageUrl,
          videoPath: mediaType === 'REELS' ? scheduledPath : null,
          videoUrl,
          videoCoverUrl,
          accounts: [{
            username: acc.username,
            igUserId: acc.igUserId,
            accessToken: acc.accessToken,
            city: acc.city,
          }],
          caption,
          hashtags: finalHashtags,
          visionTags: vision.tags,
        });
        planned.push({ username: acc.username, scheduledAt, entryId: entry.id });
      }

      if (dryRun) {
        console.log(`     caption: ${caption.slice(0, 100)}…`);
        stats.processed++;
        continue;
      }

      const processedPath = path.join(processedDir, file);
      fs.renameSync(inputPath, processedPath);

      console.log(`  ✅ Создано ${planned.length} queue-items:`);
      for (const p of planned) {
        const cityLocal = p.scheduledAt.toLocaleString('ru-RU', {
          timeZone: project.timezone,
          hour: '2-digit', minute: '2-digit', hour12: false,
        });
        console.log(`     @${p.username}: ${cityLocal} (id=${p.entryId})`);
      }
      stats.processed++;
      stats.scheduled += planned.length;
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
