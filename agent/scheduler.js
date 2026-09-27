// agent/scheduler.js — публикует посты из очереди, когда пришло время
import * as queue from './queue.js';
import { publishToInstagram } from './publishers/instagram.js';
import { notifyPublished, notifyFailed } from './telegram.js';

let running = false;

/**
 * Обрабатывает все pending-посты, время которых пришло.
 */
export async function tick() {
  if (running) {
    console.log('⏭ scheduler: предыдущий tick ещё выполняется, пропускаю');
    return;
  }
  running = true;
  try {
    const due = queue.getPending();
    if (!due.length) return;

    console.log(`\n⏰ scheduler: ${due.length} постов к публикации`);

    for (const item of due) {
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

  for (const acc of item.accounts) {
    console.log(`  → @${acc.username}`);
    const r = await publishToInstagram({
      account: acc,
      imageUrl: item.imageUrl,
      caption: `${item.caption}\n\n${(item.hashtags || []).join(' ')}`,
    });

    if (r.ok) {
      postIds.push({ username: acc.username, postId: r.postId });
      console.log(`    ✅ postId=${r.postId} (${r.durationMs}ms)`);
    } else {
      errors.push({ username: acc.username, error: r.error });
      console.error(`    ❌ ${r.error}`);
      await notifyFailed({ projectSlug: item.projectSlug, account: acc.username, error: r.error });
    }
  }

  if (postIds.length > 0) {
    queue.markPublished(item.id, postIds);
    console.log(`✅ Опубликовано в ${postIds.length}/${item.accounts.length} аккаунтов`);
    await notifyPublished({
      projectSlug: item.projectSlug,
      accounts: postIds,
      caption: item.caption,
      postId: postIds[0]?.postId,
      imageUrl: item.imageUrl,
    });
  } else {
    queue.markFailed(item.id, errors.map(e => `${e.username}: ${e.error}`).join('; '));
    console.log(`❌ Публикация не удалась ни в один аккаунт`);
  }
}
