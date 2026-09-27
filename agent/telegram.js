// agent/telegram.js — уведомления в Telegram
// env читается лениво, чтобы можно было тестировать и менять без перезапуска

function getConfig() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  };
}

export async function notify(text, { parseMode = 'HTML', prefix = '🤖 <b>[SMM]</b> ' } = {}) {
  const { token, chatId } = getConfig();
  if (!token || !chatId) return { ok: false, error: 'no telegram config' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: prefix ? `${prefix}\n\n${text}` : text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) console.warn('telegram: send failed:', data.description);
    return data;
  } catch (e) {
    console.warn('telegram: error:', e.message);
    return { ok: false, error: e.message };
  }
}

export async function notifyPublished({ projectSlug, accounts, caption, postId, imageUrl }) {
  const accList = accounts.map(a => `@${a.username}`).join(', ');
  const text = `✅ <b>Опубликовано</b>

📦 Проект: <b>${projectSlug}</b>
📍 Аккаунты: ${accList}
📝 Подпись:
<i>${(caption || '').slice(0, 200)}${caption?.length > 200 ? '…' : ''}</i>

🔗 <a href="${imageUrl}">Картинка</a>`;
  return notify(text);
}

export async function notifyFailed({ projectSlug, account, error }) {
  const text = `❌ <b>Ошибка публикации</b>

📦 Проект: <b>${projectSlug}</b>
📍 Аккаунт: @${account}
⚠️ ${(error || '').slice(0, 300)}`;
  return notify(text);
}

export async function notifyScheduled({ projectSlug, count, nextTime }) {
  const text = `📅 <b>Запланировано</b>

📦 Проект: <b>${projectSlug}</b>
🎯 Новых постов: <b>${count}</b>
⏰ Ближайший: ${nextTime}`;
  return notify(text);
}
