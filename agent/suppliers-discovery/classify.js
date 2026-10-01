
/**
 * Классификация по тексту (name + title + bio + tags).
 */
export function classifyText(text, fallback = 'other') {
  const t = String(text || '');
  if (!t) return fallback;

  // Приоритетные паттерны (сначала специфичные)
  const priority = [
    [/фотограф|photograph/i, 'photographers'],
    [/видеограф|videograph|video production/i, 'videographers'],
    [/флорист|flower|florist|букет/i, 'florists'],
    [/декор|decor|оформлен/i, 'decorators'],
    [/кейтеринг|catering|выездное питан/i, 'caterers'],
    [/диджей|\bdj\b/i, 'djs'],
    [/ведущ|тамада|\bhost\b|\bmc\b/i, 'hosts'],
    [/музык|band|live music|саксофон/i, 'musicians'],
    [/визаж|makeup|hair styl|парикмахер/i, 'makeup'],
    [/трансфер|transfer|chauffeur|такси/i, 'transfer'],
    [/wedding planner|организатор свадеб|event agency|event management/i, 'planners'],
    [/аренд|rental|tent|шатёр|шатер/i, 'rental'],
    [/аниматор|entertain|fire show|шоу-программ/i, 'entertainers'],
    [/venue|площадк|банкетн|зал|hotel|отель|ресторан/i, 'venues'],
  ];

  for (const [re, cat] of priority) {
    if (re.test(t)) return cat;
  }
  return fallback;
}

/**
 * Извлечение контактов из bio (Telegram "about").
 */
export function extractContacts(text) {
  const t = String(text || '');
  const result = {};

  // Телефон
  const phoneM = t.match(/(\+?\d[\d\s\-()]{8,18}\d)/);
  if (phoneM) result.phone = phoneM[1].replace(/\s+/g, ' ').trim();

  // Email
  const emailM = t.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailM) result.email = emailM[1];

  // Instagram
  const igM = t.match(/(?:instagram\.com\/|@)([A-Za-z0-9._]{3,30})/);
  if (igM && !/gmail|mail\.ru|yandex/i.test(igM[1])) {
    // Отсеиваем части email
    if (!emailM || !emailM[1].startsWith(igM[1])) {
      result.instagram = '@' + igM[1];
    }
  }

  // Website
  const urlM = t.match(/(https?:\/\/[^\s<>"']+)/);
  if (urlM && !/t\.me|telegram/i.test(urlM[1])) {
    result.website = urlM[1].replace(/[),.;]+$/, '');
  }

  return result;
}
