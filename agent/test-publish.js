// Быстрый тест публикации в Instagram
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('./projects/coucou-events/accounts/instagram.json', 'utf8'));
const acc = config.accounts[0];
const TOKEN = acc.accessToken;
const IG_ID = acc.igUserId;

// Тестовая картинка (публичный URL) — замени на своё фото
const IMAGE_URL = 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1080';
const CAPTION = 'Тестовый пост от Coucou Events 🎉 #coucouevents #test';

async function publish() {
  // 1. Создаём контейнер
  console.log('📦 Создаю контейнер...');
  const createUrl = `https://graph.instagram.com/v21.0/${IG_ID}/media?image_url=${encodeURIComponent(IMAGE_URL)}&caption=${encodeURIComponent(CAPTION)}&access_token=${TOKEN}`;
  
  const createRes = await fetch(createUrl, { method: 'POST' });
  const createData = await createRes.json();
  console.log('Создание:', JSON.stringify(createData, null, 2));
  
  if (!createData.id) {
    console.error('❌ Не удалось создать контейнер');
    return;
  }
  
  // 2. Ждём обработки (Instagram нужно 5-30 секунд)
  console.log('⏳ Ждём обработки 15 сек...');
  await new Promise(r => setTimeout(r, 15000));
  
  // 3. Публикуем
  console.log('🚀 Публикую...');
  const publishUrl = `https://graph.instagram.com/v21.0/${IG_ID}/media_publish?creation_id=${createData.id}&access_token=${TOKEN}`;
  
  const publishRes = await fetch(publishUrl, { method: 'POST' });
  const publishData = await publishRes.json();
  console.log('Публикация:', JSON.stringify(publishData, null, 2));
  
  if (publishData.id) {
    console.log(`✅ Опубликовано! Post ID: ${publishData.id}`);
  } else {
    console.error('❌ Не удалось опубликовать');
  }
}

publish().catch(e => console.error('Ошибка:', e.message));
