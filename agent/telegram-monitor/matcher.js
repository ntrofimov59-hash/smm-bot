// agent/telegram-monitor/matcher.js — поиск ключевых фраз и intent.
// Гибкий матчинг: если фраза ключа состоит из N слов и в тексте есть
// все эти слова (в пределах ~4 слов друг от друга) — считаем совпадением.

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  return normalize(s).split(' ').filter(Boolean);
}

/**
 * Ищем ключ как набор токенов. Все слова ключа должны быть в тексте,
 * и расстояние между первым и последним вхождением ≤ 6 токенов.
 */
function phraseMatches(tokensArr, keyTokens) {
  if (!keyTokens.length) return false;
  // одиночное слово — обычное вхождение
  if (keyTokens.length === 1) return tokensArr.includes(keyTokens[0]);

  // ищем первое вхождение первого слова
  const positions = [];
  const first = keyTokens[0];
  const last = keyTokens[keyTokens.length - 1];

  for (let i = 0; i < tokensArr.length; i++) {
    if (tokensArr[i] !== first) continue;
    // ищем последнее слово в пределах +12 токенов
    for (let j = i + 1; j < Math.min(i + 13, tokensArr.length); j++) {
      if (tokensArr[j] === last) {
        positions.push([i, j]);
        break;
      }
    }
  }
  if (!positions.length) return false;

  // в найденном диапазоне должны присутствовать все оставшиеся слова
  for (const [i, j] of positions) {
    const window = tokensArr.slice(i, j + 1);
    const allPresent = keyTokens.every(k => window.includes(k));
    if (allPresent) return true;
  }
  return false;
}

export function matchKeywords(text, keywords) {
  const tNorm = normalize(text);
  if (!tNorm) return [];
  const tTokens = tokens(text);

  const hits = [];
  const allLangs = ['ru', 'en', 'hy', 'es'];
  for (const lang of allLangs) {
    const arr = keywords[lang] || [];
    for (const kw of arr) {
      const keyTokens = tokens(kw);
      if (!keyTokens.length) continue;
      // fast path: точная подстрока
      if (tNorm.includes(normalize(kw))) {
        hits.push({ keyword: kw, lang });
        continue;
      }
      // flex path: токенный матч
      if (phraseMatches(tTokens, keyTokens)) {
        hits.push({ keyword: kw, lang });
      }
    }
  }
  return hits;
}

const PROFESSIONS = [
  'фотограф', 'фотографа', 'фотографы',
  'видеограф', 'видеографа', 'видеографы',
  'ведущ', 'тамада',
  'декоратор', 'декора', 'декоратор',
  'флорист', 'цвет',
  'кейтеринг', 'кейтеринга', 'повар', 'повара',
  'шатёр', 'шатер', 'шатра',
  'площадк', 'локаци', 'venue',
  'организатор', 'организаци',
  'dj', 'д[ие]джей', 'музык', 'гитар',
  'фотобудк', 'фотозон',
  'трансфер', 'такси',
  'стилист', 'визажист', 'макияж',
  // English
  'photographer', 'videographer', 'dj', 'host', 'mc',
  'decorator', 'florist', 'catering', 'caterer', 'venue',
  'planner', 'organizer', 'makeup', 'stylist', 'transfer',
];

const REQUEST_VERBS = [
  'ищу', 'ищем', 'нужен', 'нужна', 'нужно', 'нужны',
  'подскажите', 'посоветуйте', 'посоветуете',
  'looking for', 'need', 'any recommendations for', 'anyone know',
  'փնտրում',
];

export function detectIntent(text) {
  const t = normalize(text);
  if (!t) return null;

  const hasVerb = REQUEST_VERBS.some(v => t.includes(normalize(v)));
  if (!hasVerb) return null;

  const profs = PROFESSIONS.filter(p => new RegExp(p, 'i').test(t));
  if (!profs.length) return null;

  return { professions: profs, matchedBy: 'intent' };
}
