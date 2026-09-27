// agent/publishers/instagram.js — production-публикация в Instagram
// Использует application/x-www-form-urlencoded через URLSearchParams
import fs from 'fs';
import * as usage from '../usage.js';

const IG_API = 'https://graph.instagram.com/v21.0';

export async function publishToInstagram({ account, imageUrl, caption }) {
  const t0 = Date.now();
  const { igUserId, accessToken, username } = account;

  if (!igUserId || !accessToken) {
    return { ok: false, error: 'account: нет igUserId или accessToken', durationMs: 0 };
  }
  if (!imageUrl || !imageUrl.startsWith('https://')) {
    return { ok: false, error: 'imageUrl должен быть публичным HTTPS URL', durationMs: 0 };
  }

  try {
    // 1. Создаём контейнер
    console.log(`📦 [${username}] Создаю контейнер...`);

    const createBody = new URLSearchParams();
    createBody.set('image_url', imageUrl);
    createBody.set('caption', caption || '');
    createBody.set('access_token', accessToken);

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

    // 2. Ждём обработки — быстро для фото, дольше для видео
    let ready = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const statusUrl = `${IG_API}/${createData.id}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`;
      const statusRes = await fetch(statusUrl);
      const statusData = await statusRes.json();
      const code = statusData.status_code || 'UNKNOWN';

      if (code === 'FINISHED') { ready = true; break; }
      if (code === 'ERROR') {
        return { ok: false, error: `container error: ${statusData.status}`, durationMs: Date.now() - t0 };
      }
      // LOG для отладки
      console.log(`   ⏳ [${username}] статус: ${code} (попытка ${i + 1}/10)`);
    }

    if (!ready) {
      console.warn(`⚠️ [${username}] Контейнер не готов за 20 сек, пробую публикацию всё равно`);
    }

    // 3. Публикуем
    console.log(`🚀 [${username}] Публикую...`);
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

    console.log(`✅ [${username}] Опубликовано! postId=${publishData.id}`);
    usage.trackPost();

    return { ok: true, postId: publishData.id, durationMs: Date.now() - t0 };
  } catch (e) {
    console.error(`❌ [${username}] Ошибка:`, e.message);
    return { ok: false, error: e.message, durationMs: Date.now() - t0 };
  }
}
