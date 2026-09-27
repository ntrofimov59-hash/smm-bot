// agent/locations.js — работает с городами и локациями проекта.
// Универсальный: читает данные из project.cities любого проекта.
//
// Структура project.cities[key]:
//   {
//     displayName: "Пхукет",
//     country: "Thailand",
//     tags: ["beach", "tropical"],
//     hashtags: ["#phuket", "#thailand"],
//     landmarks: [
//       { name: "Patong Beach", hashtag: "#patongbeach", type: "beach" }
//     ],
//     nearby: ["Phi Phi Islands", "Krabi"],
//     searchQueries: ["phuket beach", "phuket sunset"]
//   }
//
// Backward compat: если у проекта есть старая структура hashtags.cities,
// getCityHashtags() умеет её читать.

import fs from 'fs';
import path from 'path';

const DEFAULT_DATA_DIR = path.resolve(new URL('./data/', import.meta.url).pathname);

function getDataDir() {
  return process.env.SMM_DATA_DIR || DEFAULT_DATA_DIR;
}

function getRotationFile() {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'landmark-rotation.json');
}

function loadRotation() {
  try {
    const file = getRotationFile();
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  return {};
}

function saveRotation(data) {
  try {
    fs.writeFileSync(getRotationFile(), JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('locations: save rotation failed:', e.message);
  }
}

/**
 * Возвращает объект города или null.
 * @param {Object} project
 * @param {string} cityKey — 'phuket' | 'yerevan' | ...
 */
export function getCity(project, cityKey) {
  if (!project || !cityKey) return null;
  return project.cities?.[cityKey] || null;
}

/**
 * Все ключи городов, заведённых в проекте.
 */
export function listCities(project) {
  return Object.keys(project?.cities || {});
}

/**
 * Теги города (для матчинга фото).
 * Fallback — hashtags.cities.<key> не даёт тегов, поэтому только cities.<key>.tags.
 */
export function getCityTags(project, cityKey) {
  const city = getCity(project, cityKey);
  return Array.isArray(city?.tags) ? city.tags : [];
}

/**
 * Хештеги города. Сначала ищем в cities.<key>.hashtags,
 * иначе — в старой структуре hashtags.cities.<key>.
 */
export function getCityHashtags(project, cityKey) {
  const city = getCity(project, cityKey);
  if (Array.isArray(city?.hashtags) && city.hashtags.length) return city.hashtags;
  return project?.hashtags?.cities?.[cityKey] || [];
}

/**
 * Возвращает локацию города с ротацией по кругу.
 *
 * @param {Object} project
 * @param {string} cityKey
 * @param {Object} [opts]
 * @param {string} [opts.type] — фильтр по типу ('beach', 'culture', ...)
 * @param {string[]} [opts.exclude] — имена, которые не выбирать
 * @returns {{name, hashtag, type}|null}
 */
export function pickLandmark(project, cityKey, opts = {}) {
  const { type, exclude = [] } = opts;
  const city = getCity(project, cityKey);
  if (!city?.landmarks?.length) return null;

  let candidates = city.landmarks;
  if (type) {
    const filtered = candidates.filter(l => l.type === type);
    if (filtered.length) candidates = filtered;
  }
  if (exclude.length) {
    const filtered = candidates.filter(l => !exclude.includes(l.name));
    if (filtered.length) candidates = filtered;
  }
  if (!candidates.length) return null;

  // Ротация: храним индекс по ключу city|type
  const rotKey = `${cityKey}|${type || 'any'}`;
  const rotation = loadRotation();
  const lastIdx = Number.isInteger(rotation[rotKey]) ? rotation[rotKey] : -1;
  const nextIdx = (lastIdx + 1) % candidates.length;
  rotation[rotKey] = nextIdx;
  saveRotation(rotation);

  return candidates[nextIdx];
}

/**
 * Строка-контекст для LLM: "Place: Patong Beach, Phuket, Thailand. Nearby: Phi Phi Islands, Krabi."
 */
export function buildCaptionContext(project, cityKey, { landmark } = {}) {
  const city = getCity(project, cityKey);
  if (!city) return '';

  const parts = [];
  const place = landmark?.name
    ? `${landmark.name}, ${city.displayName}`
    : city.displayName;
  const country = city.country ? `, ${city.country}` : '';
  parts.push(`Place: ${place}${country}.`);

  if (city.nearby?.length) {
    parts.push(`Nearby: ${city.nearby.join(', ')}.`);
  }
  return parts.join(' ');
}

/**
 * Запросы для внешнего поиска фото (Pinterest / Graph).
 * @returns {string[]}
 */
export function buildSearchQueries(project, cityKey, { limit = 10 } = {}) {
  const city = getCity(project, cityKey);
  if (!city) return [];
  const queries = [];
  if (Array.isArray(city.searchQueries)) queries.push(...city.searchQueries);
  if (!queries.length) {
    // фолбэк: <displayName> + tags
    for (const tag of city.tags || []) {
      queries.push(`${city.displayName} ${tag}`);
    }
  }
  return queries.slice(0, limit);
}

/**
 * Сброс ротации (для тестов / ручного вмешательства).
 */

/**
 * Подбирает локацию, ориентируясь на теги vision (beach/nature/city/...).
 * Если ни один тег не совпал с type локации — возвращает любую по ротации.
 *
 * @param {Object} project
 * @param {string} cityKey
 * @param {string[]} visionTags
 * @returns {{name, hashtag, type}|null}
 */
export function pickLandmarkForVision(project, cityKey, visionTags = []) {
  const city = getCity(project, cityKey);
  if (!city?.landmarks?.length) return null;

  for (const tag of visionTags) {
    const hasType = city.landmarks.some(l => l.type === tag);
    if (hasType) {
      return pickLandmark(project, cityKey, { type: tag });
    }
  }
  return pickLandmark(project, cityKey);
}

export function resetRotation() {
  saveRotation({});
}
