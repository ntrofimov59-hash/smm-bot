// agent/telegram-monitor/scorer.js — автооценка релевантности.
// Жёстко фильтрует мусор, зарубежные, знакомства, одиночные каналы.

const PROJECT_CITIES = new Set([
  'yerevan', 'ереван', 'erevan', 'armenia', 'армения',
  'tbilisi', 'тбилиси', 'georgia', 'грузия',
  'bali', 'бали', 'canggu', 'ubud', 'denpasar', 'indonesia', 'индонезия',
  'phuket', 'пхукет', 'thailand', 'таиланд',
  'prague', 'прага', 'czech', 'чехия',
  'barcelona', 'барселона', 'spain', 'испания',
  'marrakech', 'марракеш', 'casablanca', 'касабланка', 'morocco', 'марокко',
  'danang', 'дананг', 'nha trang', 'нячанг', 'vietnam', 'вьетнам',
]);

const EVENT_KEYWORDS = [
  'event', 'events', 'мероприят', 'ивент', 'свадьб', 'wedding', 'party',
  'праздник', 'корпоратив', 'venue', 'площадк', 'catering', 'кейтеринг',
  'photographer', 'фотограф', 'decorat', 'декорат', 'florist', 'флорист',
  'planner', 'организатор', 'ведущ', 'host', 'dj', 'transfer', 'трансфер',
];

const EXPAT_KEYWORDS = [
  'expats', 'expat', 'digital nomad', 'номад', 'nomads', 'relocation',
  'релокац', 'переезд', 'community', 'сообществ', 'чат',
];

const IRRELEVANT = [
  // Крипта, финансы, спам
  'crypto', 'bitcoin', 'крипт', 'биткоин', 'forex', 'invest', 'инвестиц',
  'кредит', 'займ', 'ставки', 'betting', 'casino', 'казино',
  // 18+
  'nude', 'sex', 'порн', '18+', 'bdsm', 'escort', 'интим', 'свинг',
  // Наркотики
  'narkotik', 'narcotic', 'наркот', 'мефедрон', 'закладк', 'cocaine', 'кокаин',
  // Знакомства
  'знакомств', 'dating', 'hookup', 'relationships', 'pickup', 'пикап',
  // Вакансии / резюме
  'вакансии', 'vacancy', 'резюме', 'ищу работу', 'работа в', 'job', 'jobsearch',
  // Политика / новости мира
  'политик', 'politics', 'новости мира', 'world news',
  // Барахолки / продажа
  'барахолк', 'продам', 'куплю', 'продаю', 'классифайд', 'classifieds',
  // Хакеры / читы
  'hack', 'хакер', 'взлом', 'чит', 'cheat',
  // Порно/xxx
  'porn', 'xxx', 'of model', 'onlyfans',
  // Спорт / футбол / аниме / игры
  'football', 'футбол', ' fc ', 'fc barselona', 'fc barcelona', 'soccer',
  'basketball', 'nba', 'nhl', 'ufc',
  'anime', 'аниме', 'manga',
  'csgo', 'dota', 'pubg', 'genshin', 'valorant', 'warzone',
  'gaming', 'гейминг', 'клан',
];

// Зарубежные столицы/страны, которые часто попадают но НЕ наши
const FOREIGN_MARKERS = [
  'london', 'sicilian', 'sicily', 'maat', 'egypt', 'cairo', 'kuwait',
  'dubai', 'qatar', 'doha', 'riyadh', 'manama', 'muscat',
  'kyiv', 'kiev', 'киев', 'moscow', 'москва', 'спб', 'petersburg',
  'berlin', 'paris', 'париж', 'amsterdam', 'romе', 'рим',
  'new york', 'los angeles', 'miami',
  'india', 'vizag', 'indovisual', 'jamaica', 'krabi', 'phuket cocain',
];

function textOf(c) {
  return [c.username || '', c.title || '', c.description || '', c.context || '']
    .join(' ').toLowerCase();
}

function hasAny(t, arr) {
  return arr.some(k => t.includes(k));
}

function isJunkUsername(u) {
  if (!u) return true;
  const s = String(u).toLowerCase();
  if (s.length < 4) return true;
  // 6+ цифр подряд, случайные буквы, "test123456"
  if (/\d{6,}/.test(s)) return true;
  if (/^[a-z]{8,}$/i.test(s) && !hasAny(s, ['events', 'wedding', 'expat', 'bali', 'yerevan', 'tbilisi', 'prague'])) return true;
  return false;
}

export function scoreCandidate(c) {
  const t = textOf(c);
  const reasons = [];
  let score = 30;

  // Жёсткий отсев
  if (isJunkUsername(c.username)) {
    return { score: 0, reasons: ['мусорный username'], verdict: 'drop' };
  }
  if (c.reviewData?.type === 'user' || c.reviewData?.type === 'bot') {
    return { score: 0, reasons: ['не канал/группа'], verdict: 'drop' };
  }

  // Мусорное содержание
  const badHit = IRRELEVANT.find(k => t.includes(k));
  if (badHit) {
    return { score: 0, reasons: [`мусор: ${badHit}`], verdict: 'drop' };
  }

  // Зарубежные, не наши
  const foreignHit = FOREIGN_MARKERS.find(k => t.includes(k));
  if (foreignHit) {
    score -= 40;
    reasons.push(`❌ не наш регион: ${foreignHit}`);
  }

  // Проверка города
  const cityHit = [...PROJECT_CITIES].find(k => t.includes(k));
  if (cityHit) { score += 25; reasons.push(`+ город/страна: ${cityHit}`); }

  // Event-тематика
  const eventHit = EVENT_KEYWORDS.find(k => t.includes(k));
  if (eventHit) { score += 25; reasons.push(`+ event: ${eventHit}`); }

  // Экспаты — только если есть город проекта
  const expatHit = EXPAT_KEYWORDS.find(k => t.includes(k));
  if (expatHit && cityHit) {
    score += 15;
    reasons.push(`+ экспаты/DN`);
  } else if (expatHit) {
    reasons.push(`⚠️ экспаты без привязки к городу`);
  }

  // Подписчики — жёсткий фильтр
  const subs = typeof c.subscribers === 'number' ? c.subscribers : null;
  if (subs === 0) { score -= 10; reasons.push('- 0 подписчиков'); }
  else if (subs && subs < 30) { score -= 25; reasons.push(`- мало (${subs})`); }
  else if (subs && subs < 100) { score -= 10; reasons.push(`- мало (${subs})`); }
  else if (subs && subs >= 5000) { score += 20; reasons.push(`+ ${subs}`); }
  else if (subs && subs >= 500) { score += 12; reasons.push(`+ ${subs}`); }

  // Тип: группы полезнее каналов
  const type = c.reviewData?.type;
  if (type === 'megagroup' || type === 'chat') { score += 10; reasons.push('+ группа'); }
  else if (type === 'channel') { score -= 5; reasons.push('- канал'); }

  // Если никто не сработал — drop
  if (!cityHit && !eventHit && !expatHit) {
    score -= 20;
    reasons.push('- нет тематики');
  }

  score = Math.max(0, Math.min(100, score));

  let verdict = 'review';
  if (score >= 60) verdict = 'keep';
  else if (score < 30) verdict = 'drop';

  return { score, reasons, verdict };
}

export function classifyCandidates(candidates) {
  return candidates.map(c => ({ ...c, _score: scoreCandidate(c) }));
}
