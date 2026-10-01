// agent/scheduler.js — публикует посты из очереди, когда пришло время
// accessToken берётся из accounts.json, не из queue (legacy fallback есть).
import * as queue from './queue.js';
import * as usage from './usage.js';
import { publishToInstagram } from './publishers/instagram.js';
import { notifyPublished, notifyFailed } from './telegram.js';
import { resolveAccountForPublish } from './accounts-resolver.js';

let running = false;

export async function tick() {
  if (running) {
    console.log('⏭ scheduler: предыдущий tick ещё выполняется, пропускаю');
    return;
  }
  running = true;
  try {
    const due = queue.getPending();
    if (!due.length) return;

    const can = usage.canPublishPost();
    if (!can.ok) {
      console.warn(`🚫 Лимит постов исчерпан (${can.reason}), пропускаю публикацию`);
      return;
    }

    console.log(`\n⏰ scheduler: ${due.length} постов к публикации`);

    for (const item of due) {
      const stillCan = usage.canPublishPost();
      if (!stillCan.ok) {
        console.warn(`🚫 Лимит постов достигнут во время публикации, останавливаюсь`);
        break;
      }
      await publishItem(item);
    }
  } finally {
    running = false;
  }
}

async function publishItem(item) {
  console.log(`\n📤 Публикую ${item.id} (проект: ${item.projectSlug})`);
  queue.updateItem(item.id, { status: 'publishing' });
  queue.incrementAttempts(item.id);

  const postIds = [];
  const errors = [];

  for (const accRef of item.accounts || []) {
    const account = resolveAccountForPublish(item, accRef);
    if (!account) {
      const err = `нет токена для @${accRef?.username || accRef?.igUserId} (проверь accounts.json)`;
      console.error(`    ❌ ${err}`);
      errors.push({ username: accRef?.username || '?', error: err });
      await notifyFailed({
        projectSlug: item.projectSlug,
        account: accRef?.username || '?',
        error: err,
      });
      continue;
    }

    console.log(`  → @${account.username} (${(item.mediaType || 'IMAGE')})`);
    const mediaType = (item.mediaType || 'IMAGE').toUpperCase();
    const captionText = mediaType === 'STORIES'
      ? ''
      : `${item.caption}\n\n${(item.hashtags || []).join(' ')}`;

    const r = await publishToInstagram({
      account,
      mediaType,
      imageUrl: item.imageUrl,
      videoUrl: item.videoUrl,
      coverUrl: item.videoCoverUrl,
      caption: captionText,
    });

    if (r.ok) {
      postIds.push({ username: account.username, postId: r.postId });
      console.log(`    ✅ postId=${r.postId} (${r.durationMs}ms)`);
    } else {
      errors.push({ username: account.username, error: r.error });
      console.error(`    ❌ ${r.error}`);
      await notifyFailed({
        projectSlug: item.projectSlug,
        account: account.username,
        error: r.error,
      });
    }
  }

  if (postIds.length > 0) {
    queue.markPublished(item.id, postIds);
    console.log(`✅ Опубликовано в ${postIds.length}/${(item.accounts || []).length} аккаунтов`);
    await notifyPublished({
      projectSlug: item.projectSlug,
      accounts: postIds,
      caption: item.caption,
      postId: postIds[0]?.postId,
      imageUrl: item.imageUrl,
    });
  } else {
    queue.markFailed(item.id, errors.map((e) => `${e.username}: ${e.error}`).join('; '));
    console.log(`❌ Публикация не удалась ни в один аккаунт`);
  }
}
