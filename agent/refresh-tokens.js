// agent/refresh-tokens.js — автообновление Instagram токенов
// Cron: раз в неделю, но обновляет только токены старше 45 дней
import fs from 'fs';
import path from 'path';
import { notify } from './telegram.js';

const PROJECTS_DIR = path.resolve(new URL('../projects/', import.meta.url).pathname);

// Обновляем, если токен не обновлялся более 45 дней
const REFRESH_AFTER_DAYS = 45;

async function refreshToken(token) {
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`;
  const res = await fetch(url);
  return res.json();
}

async function refreshProject(projectPath, projectSlug) {
  const accountsPath = path.join(projectPath, 'accounts.json');
  if (!fs.existsSync(accountsPath)) return null;

  const cfg = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
  if (!cfg.instagram?.length) return null;

  console.log(`\n📦 Проект: ${projectSlug} (${cfg.instagram.length} аккаунтов)\n`);

  const results = [];
  let updated = false;

  for (let i = 0; i < cfg.instagram.length; i++) {
    const account = cfg.instagram[i];
    const username = account.username;

    // Пропускаем неактивные/placeholder
    if (!account.active || !account.accessToken || account.accessToken.length < 50) {
      console.log(`⏭  @${username} — неактив или нет токена`);
      continue;
    }

    // Проверяем, надо ли обновлять
    if (account.refreshedAt) {
      const daysSince = (Date.now() - new Date(account.refreshedAt).getTime()) / 86400000;
      if (daysSince < REFRESH_AFTER_DAYS) {
        console.log(`⏭  @${username} — обновлён ${Math.round(daysSince)} дн. назад, пропускаю`);
        continue;
      }
    }

    console.log(`🔄 @${username}`);
    try {
      const data = await refreshToken(account.accessToken);

      if (data.error) {
        console.error(`  ❌ ${data.error.message}`);
        results.push({ username, ok: false, error: data.error.message });
        continue;
      }

      if (!data.access_token) {
        results.push({ username, ok: false, error: 'no_token' });
        continue;
      }

      const daysLeft = Math.round((data.expires_in || 0) / 86400);
      console.log(`  ✅ Обновлён, действует ${daysLeft} дней`);

      cfg.instagram[i].accessToken = data.access_token;
      cfg.instagram[i].refreshedAt = new Date().toISOString();
      cfg.instagram[i].expiresIn = data.expires_in;
      updated = true;

      results.push({ username, ok: true, daysLeft });
    } catch (e) {
      console.error(`  ❌ ${e.message}`);
      results.push({ username, ok: false, error: e.message });
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  if (updated) {
    fs.writeFileSync(accountsPath, JSON.stringify(cfg, null, 2));
    console.log(`\n💾 ${projectSlug}/accounts.json обновлён`);
  } else {
    console.log(`\nℹ️  ${projectSlug}: ничего не требовало обновления`);
  }

  return results;
}

async function main() {
  console.log('🔐 Автообновление Instagram токенов');
  console.log(`   ${new Date().toISOString()}\n`);

  if (!fs.existsSync(PROJECTS_DIR)) {
    console.error('❌ Нет папки projects/');
    process.exit(1);
  }

  const projects = fs.readdirSync(PROJECTS_DIR).filter(d => {
    try { return fs.statSync(path.join(PROJECTS_DIR, d)).isDirectory(); }
    catch { return false; }
  });

  const summary = { total: 0, ok: 0, failed: 0, skipped: 0 };
  const errors = [];
  let updatedCount = 0;

  for (const slug of projects) {
    const results = await refreshProject(path.join(PROJECTS_DIR, slug), slug);
    if (!results) continue;

    for (const r of results) {
      summary.total++;
      if (r.ok) { summary.ok++; updatedCount++; }
      else { summary.failed++; errors.push(`@${r.username}: ${r.error}`); }
    }
  }

  // Отчёт в Telegram — только если что-то обновляли или были ошибки
  if (updatedCount > 0 || summary.failed > 0) {
    const emoji = summary.failed === 0 ? '✅' : '⚠️';
    const msg = `${emoji} <b>Обновление Instagram токенов</b>

📊 Обновлено: <b>${summary.ok}</b>
❌ Ошибки: <b>${summary.failed}</b>

${errors.length ? `⚠️ <b>Проблемы:</b>\n${errors.join('\n')}` : ''}`;

    await notify(msg);
    console.log('\n📬 Отчёт отправлен в Telegram');
  } else {
    console.log('\nℹ️  Ничего не обновлялось, отчёт не отправляю');
  }

  console.log(`\n=== ИТОГИ ===`);
  console.log(`Обновлено: ${summary.ok}, Ошибок: ${summary.failed}`);
}

main().catch(e => {
  console.error('FATAL:', e);
  notify(`❌ Ошибка автообновления токенов: ${e.message}`).catch(() => {});
  process.exit(1);
});
