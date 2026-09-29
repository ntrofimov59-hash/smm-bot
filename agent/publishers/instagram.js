// agent/publishers/instagram.js — публикация в Instagram через Instagram API with Instagram Login
// Поддерживает IMAGE, REELS, STORIES.
//
// API (graph.instagram.com/v23.0):
//   IMAGE:  POST /<IG_ID>/media          { image_url, caption, access_token }
//   REELS:  POST /<IG_ID>/media          { media_type=REELS, video_url, cover_url?, caption, access_token }
//   STORIES:POST /<IG_ID>/media          { media_type=STORIES, video_url|image_url, access_token }
//
// После создания контейнера — опрос GET /<CONTAINER_ID>?fields=status_code пока не FINISHED.
// Для видео обработка асинхронная (30-90 сек). Лимит ожидания увеличен до ~5 минут.
//
// Публикация: POST /<IG_ID>/media_publish { creation_id, access_token }
//
// Лимит: 50 публикаций/сутки на аккаунт (все типы).

import * as usage from '../usage.js';

const IG_API = 'https://graph.instagram.com/v23.0';

// Настраивается через env — тесты выставляют 1 мс.
function getPollIntervalMs() {
  return Number(process.env.IG_POLL_INTERVAL_MS || 5000);
}
function getMaxPollAttempts(mediaType) {
  if (process.env.IG_MAX_POLL_ATTEMPTS) return Number(process.env.IG_MAX_POLL_ATTEMPTS);
  return mediaType === 'IMAGE' ? 10 : 60;
}

/**
 * Публикация в Instagram.
 *
 * @param {Object} opts
 * @param {Object} opts.account       — { igUserId, accessToken, username }
 * @param {'IMAGE'|'REELS'|'STORIES'} opts.mediaType
 * @param {string} [opts.imageUrl]    — публичный HTTPS URL фото (для IMAGE/STORIES)
 * @param {string} [opts.videoUrl]    — публичный HTTPS URL видео (для REELS/STORIES)
 * @param {string} [opts.coverUrl]    — публичный HTTPS URL обложки (опционально для REELS)
 * @param {string} [opts.caption]     — подпись (для REELS/IMAGE; для STORIES игнорируется Meta)
 */
export async function publishToInstagram({
  account,
  mediaType = 'IMAGE',
  imageUrl,
  videoUrl,
  coverUrl,
  caption,
}) {
  const t0 = Date.now();
  const { igUserId, accessToken, username } = account;

  if (!igUserId || !accessToken) {
    return { ok: false, error: 'account: нет igUserId или accessToken', durationMs: 0 };
  }

  // Валидация входа по типу
  const type = String(mediaType).toUpperCase();
  if (type === 'IMAGE') {
    if (!imageUrl || !imageUrl.startsWith('https://')) {
      return { ok: false, error: 'IMAGE: нужен публичный HTTPS imageUrl', durationMs: 0 };
    }
  } else if (type === 'REELS') {
    if (!videoUrl || !videoUrl.startsWith('https://')) {
      return { ok: false, error: 'REELS: нужен публичный HTTPS videoUrl', durationMs: 0 };
    }
  } else if (type === 'STORIES') {
    const src = videoUrl || imageUrl;
    if (!src || !src.startsWith('https://')) {
      return { ok: false, error: 'STORIES: нужен публичный HTTPS videoUrl или imageUrl', durationMs: 0 };
    }
  } else {
    return { ok: false, error: `mediaType: неизвестный "${mediaType}" (IMAGE|REELS|STORIES)`, durationMs: 0 };
  }

  try {
    // 1. Создаём контейнер
    console.log(`📦 [${username}] Создаю контейнер (${type})...`);

    const createBody = new URLSearchParams();
    createBody.set('access_token', accessToken);

    if (type === 'IMAGE') {
      createBody.set('image_url', imageUrl);
      createBody.set('caption', caption || '');
    } else if (type === 'REELS') {
      createBody.set('media_type', 'REELS');
      createBody.set('video_url', videoUrl);
      if (coverUrl) createBody.set('cover_url', coverUrl);
      createBody.set('caption', caption || '');
    } else if (type === 'STORIES') {
      createBody.set('media_type', 'STORIES');
      if (videoUrl) createBody.set('video_url', videoUrl);
      else createBody.set('image_url', imageUrl);
      // STORIES не принимают caption — API их игнорирует, не отправляем
    }

    const createRes = await fetch(`${IG_API}/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createBody.toString(),
    });
    const createData = await createRes.json();

    if (!createRes.ok || !createData.id) {
      const err = createData.error?.message || JSON.stringify(createData);
      console.error(`❌ [${username}] Контейнер не создан:`, err);
      return { ok: false, error: `create_container: ${err}`, durationMs: Date.now() - t0 };
    }

    console.log(`📦 [${username}] containerId=${createData.id}`);

    // 2. Ждём обработки. Для IMAGE быстро (2-3 сек), для REELS/STORIES — дольше.
    const maxAttempts = getMaxPollAttempts(type);
    let ready = false;
    let lastStatus = 'UNKNOWN';

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, getPollIntervalMs()));
      const statusUrl = `${IG_API}/${createData.id}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`;
      const statusRes = await fetch(statusUrl);
      const statusData = await statusRes.json();
      const code = statusData.status_code || 'UNKNOWN';
      lastStatus = code;

      if (code === 'FINISHED') { ready = true; break; }
      if (code === 'ERROR') {
        const detail = statusData.status || '(без деталей)';
        console.error(`❌ [${username}] Контейнер в ERROR: ${detail}`);
        return { ok: false, error: `container error: ${detail}`, durationMs: Date.now() - t0 };
      }

      if (i % 4 === 0) {
        console.log(`   ⏳ [${username}] ${type} статус: ${code} (попытка ${i + 1}/${maxAttempts})`);
      }
    }

    if (!ready) {
      console.warn(`⚠️ [${username}] Контейнер не готов за ${maxAttempts * getPollIntervalMs() / 1000} сек (последний статус: ${lastStatus})`);
      // для IMAGE попробуем публиковать, для видео — нет смысла
      if (type !== 'IMAGE') {
        return {
          ok: false,
          error: `container timeout: last=${lastStatus}`,
          durationMs: Date.now() - t0,
        };
      }
    }

    // 3. Публикуем
    console.log(`🚀 [${username}] Публикую ${type}...`);
    const publishBody = new URLSearchParams();
    publishBody.set('creation_id', createData.id);
    publishBody.set('access_token', accessToken);

    const publishRes = await fetch(`${IG_API}/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: publishBody.toString(),
    });
    const publishData = await publishRes.json();

    if (!publishRes.ok || !publishData.id) {
      const err = publishData.error?.message || JSON.stringify(publishData);
      console.error(`❌ [${username}] Публикация не удалась:`, err);
      return { ok: false, error: `publish: ${err}`, durationMs: Date.now() - t0 };
    }

    console.log(`✅ [${username}] ${type} опубликован! postId=${publishData.id}`);
    usage.trackPost();

    return {
      ok: true,
      mediaType: type,
      postId: publishData.id,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    console.error(`❌ [${username}] Ошибка:`, e.message);
    return { ok: false, error: e.message, durationMs: Date.now() - t0 };
  }
}
