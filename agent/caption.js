// agent/caption.js — генерация подписи через Groq (без strict JSON)
import OpenAI from 'openai';
import * as usage from './usage.js';

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const MODEL = process.env.GROQ_CAPTION_MODEL || 'openai/gpt-oss-120b';

export async function generateCaption(opts) {
  const {
    description = '',
    topics = [],
    mood = '',
    city = '',
    project,
    lang = 'ru',
    service = null,
  } = opts;

  const can = usage.canCallGroq(1500);
  if (!can.ok) {
    console.warn(`🚫 Groq лимит: ${can.reason}`);
    return { caption: fallbackCaption(city, mood, topics, lang), hashtags: [], tokens: 0, limited: true };
  }

  const brand = project.brand || {};
  const maxHashtags = project.publishing?.maxHashtags || 12;

  const langInstruction = {
    ru: 'Пиши на русском языке.',
    en: 'Write in English.',
    hy: 'Գրիր հայերենով:',
  }[lang] || 'Пиши на русском языке.';

  const systemPrompt = `Ты — SMM-редактор агентства событий "Coucou Events".

Пишешь короткую, тёплую подпись для Instagram-поста.
Стиль: ${brand.tone || 'тёплый, но профессиональный'}
Голос: ${brand.voice || 'от лица Анны, старшего менеджера, женский род'}
Эмодзи: ${brand.emoji || 'умеренно, 1-3 на пост'}
Избегай: ${(brand.avoid || []).join(', ') || 'канцелярит, шаблоны'}

${langInstruction}

ФОРМАТ ОТВЕТА — строго так, без отклонений:

ПРИМЕР ПРАВИЛЬНОГО ОТВЕТА:

CAPTION:
Представьте себе вечер на берегу Пхукета, когда солнце клонится к горизонту 🌅 Тёплый бриз и нежные волны создадут атмосферу, о которой вы мечтали ✨

HASHTAGS:
#phuketwedding #beachwedding #sunsetvibes #destinationwedding #coucouevents

ПРАВИЛА:
- НЕ выдумывай факты. Если на фото пляж — о пляже.
- НЕ упоминай цены.
- Обращайся на «вы» (ru/hy) или нейтрально (en).`;

  const userPrompt = `Что на фото: ${description}
Настроение: ${mood || 'не указано'}
Темы: ${topics.join(', ') || 'нет'}
${city ? `Город: ${city}` : ''}
${service ? `Услуга: ${service}` : ''}`;

  try {
    const resp = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 600,
      // БЕЗ response_format — парсим вручную
    });

    const tokens = resp.usage?.total_tokens || 0;
    usage.trackGroq(tokens);

    const raw = resp.choices[0]?.message?.content || '';
    const parsed = parseStructuredResponse(raw);

    // Собираем caption
    let caption = (parsed.caption || '').trim();
    if (!caption) {
      console.warn('caption: пустой caption от LLM, использую fallback');
      caption = fallbackCaption(city, mood, topics, lang);
    }

    // Добавляем подпись если её нет
    const signature = brand.signature || 'Команда Coucou Events 🎉';
    const signatureRoot = signature.split(' ').slice(-2).join(' ').slice(0, 15);
    if (!caption.includes(signatureRoot) && !caption.includes('Coucou')) {
      caption += `\n\n${signature}`;
    }

    // Хештеги
    let hashtags = parsed.hashtags.filter(h => h.startsWith('#')).slice(0, maxHashtags);

    return { caption, hashtags, tokens };
  } catch (e) {
    console.error('caption: ошибка Groq:', e.message);
    return {
      caption: fallbackCaption(city, mood, topics, lang),
      hashtags: [],
      tokens: 0,
      error: e.message,
    };
  }
}

// Парсер структурированного ответа (не строгий JSON)
function parseStructuredResponse(raw) {
  const text = String(raw || '');

  // Вариант 1: секции CAPTION: ... HASHTAGS: ...
  const captionMatch = text.match(/CAPTION\s*:?\s*\n?([\s\S]*?)(?=\n\s*HASHTAGS\s*:|\n\s*$)/i);
  const hashtagsMatch = text.match(/HASHTAGS\s*:?\s*\n?([\s\S]*?)$/i);

  let caption = '';
  let hashtags = [];

  if (captionMatch) {
    caption = captionMatch[1].trim();
  }
  if (hashtagsMatch) {
    hashtags = (hashtagsMatch[1].match(/#[\w\d_]+/g) || []);
  }

  // Вариант 2 (fallback): пробуем JSON
  if (!caption) {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        caption = parsed.caption || parsed.text || '';
        hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags : [];
      }
    } catch {}
  }

  // Вариант 3 (fallback): весь текст — caption, хештеги извлекаем
  if (!caption) {
    const lines = text.split('\n').filter(l => l.trim());
    const captionLines = [];
    const hashtagLine = [];
    for (const line of lines) {
      if (/^\s*#/.test(line.trim())) {
        hashtagLine.push(...line.match(/#[\w\d_]+/g) || []);
      } else {
        captionLines.push(line);
      }
    }
    caption = captionLines.join('\n').trim();
    hashtags = hashtagLine;
  }

  return { caption, hashtags };
}

function fallbackCaption(city, mood, topics, lang) {
  const texts = {
    ru: `Создаём красивые события${city ? ` в ${city}` : ''} 🎉`,
    en: `Creating beautiful events${city ? ` in ${city}` : ''} 🎉`,
    hy: `Ստեղծում ենք գեղեցիկ միջոցառումներ${city ? ` ${city}-ում` : ''} 🎉`,
  };
  return texts[lang] || texts.ru;
}
