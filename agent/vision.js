// agent/vision.js — анализ фото через Gemini с retry + кэш + Groq fallback
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { getCached, setCache } from './vision-cache.js';
import * as usage from './usage.js';

// Lazy SDK init — иначе модуль падает при импорте, если ключей нет
// (важно для CI и для e2e-тестов, где dotenv не подхватывает .env)
let _ai, _groq;
function getGemini() {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _ai;
}
function getGroq() {
  if (!_groq) _groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });
  return _groq;
}

// Каскад моделей Gemini: если одна перегружена — идём на следующую
const GEMINI_MODELS = [
  process.env.GEMINI_VISION_MODEL || 'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-flash-latest',
].filter((v, i, a) => a.indexOf(v) === i); // уникальные
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b';

const SYSTEM_PROMPT = `You are a visual content analyst for an event-planning agency (Coucou Events).
Analyze the image and return STRICT JSON only (no markdown, no code fences).

Return exactly this structure:
{
  "description": "1-2 sentences describing what's on the photo (in English)",
  "tags": ["from-list-only"],
  "mood": "one of: cozy, festive, romantic, elegant, tropical, adventure, minimal, luxury",
  "primary_color": "#RRGGBB",
  "has_people": true|false,
  "suggested_topics": ["3-5 short keyword hints for a social-media caption"]
}

Tags MUST be chosen from this fixed list (only those that apply):
beach, tropical, ocean, sunset, mountain, forest, nature, garden,
city, urban, architecture, interior, restaurant, table, food, dessert,
flowers, decor, tent, marquee, lights, party, ceremony, couple, guests, kids`;

function mimeFor(path) {
  const ext = path.toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

function parseJson(raw) {
  const cleaned = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn('vision: JSON parse failed:', e.message);
    return null;
  }
}

function normalize(parsed) {
  return {
    description: parsed?.description || '',
    tags: Array.isArray(parsed?.tags) ? parsed.tags : [],
    mood: parsed?.mood || '',
    primaryColor: parsed?.primary_color || null,
    hasPeople: !!parsed?.has_people,
    suggestedTopics: Array.isArray(parsed?.suggested_topics) ? parsed.suggested_topics : [],
  };
}

async function retry(fn, { attempts = 3, baseDelay = 2000, label = 'vision' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e?.status || e?.response?.status;
      // 503 / 429 — retryable
      const retryable = status === 503 || status === 429 || /UNAVAILABLE|rate.?limit|timeout/i.test(e?.message || '');
      if (!retryable || i === attempts - 1) throw e;
      const delay = baseDelay * Math.pow(2, i);
      console.warn(`⚠️ ${label}: ${status || 'error'} — retry через ${delay}ms (${i+1}/${attempts})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// === Gemini провайдер ===
async function viaGemini(imagePath) {
  const buffer = fs.readFileSync(imagePath);
  const base64 = buffer.toString('base64');
  const mime = mimeFor(imagePath);

  let lastErr;
  for (const model of GEMINI_MODELS) {
    try {
      console.log(`🔷 Пробую Gemini: ${model}`);
      const result = await retry(async () => {
        usage.trackGemini();
        const response = await getGemini().models.generateContent({
          model,
          contents: [{
            role: 'user',
            parts: [
              { text: SYSTEM_PROMPT },
              { inlineData: { mimeType: mime, data: base64 } },
            ],
          }],
        });
        const parsed = parseJson(response.text);
        if (!parsed) throw new Error('Gemini: invalid JSON');
        return normalize(parsed);
      }, { attempts: 2, baseDelay: 2000, label: `Gemini/${model}` });
      return result;
    } catch (e) {
      lastErr = e;
      const status = e?.status || e?.response?.status;
      // 503 — идём на следующую модель
      if (status === 503 || /UNAVAILABLE|overloaded/i.test(e?.message || '')) {
        console.warn(`⚠️ ${model} перегружена (503), пробую следующую модель...`);
        continue;
      }
      // Другая ошибка — не retryable
      throw e;
    }
  }
  throw lastErr;
}

// === Groq Vision fallback ===
async function viaGroqVision(imagePath) {
  const buffer = fs.readFileSync(imagePath);
  const base64 = buffer.toString('base64');
  const mime = mimeFor(imagePath);

  return retry(async () => {
    const resp = await getGroq().chat.completions.create({
      model: GROQ_VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: SYSTEM_PROMPT },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
        ],
      }],
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });
    const parsed = parseJson(resp.choices[0]?.message?.content);
    if (!parsed) throw new Error('Groq Vision: invalid JSON');
    return normalize(parsed);
  }, { attempts: 2, baseDelay: 1500, label: 'Groq Vision' });
}

// === Публичная функция ===
export async function analyzeImage(imagePath, { useCache = true, provider = 'auto' } = {}) {
  // 1. Кэш
  if (useCache) {
    const cached = getCached(imagePath);
    if (cached) {
      usage.trackCacheHit();
      return { ...cached, _fromCache: true };
    }
  }

  // Проверяем лимит Gemini
  const canGem = usage.canCallGemini();
  if (!canGem.ok) {
    console.warn(`🚫 Gemini лимит исчерпан: ${canGem.reason} — идём сразу в Groq fallback`);
  }

  // 2. Провайдер
  let result = null;
  const errors = [];

  const tryProvider = async (name, fn) => {
    try {
      const r = await fn(imagePath);
      console.log(`✅ vision: ${name} OK`);
      return r;
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
      console.warn(`❌ vision: ${name} failed — ${e.message}`);
      return null;
    }
  };

  if ((provider === 'gemini' || provider === 'auto') && canGem.ok) {
    result = await tryProvider('Gemini', viaGemini);
  } else if (provider === 'auto' && !canGem.ok) {
    console.log('↪️ Пропускаю Gemini (лимит), иду в Groq Vision');
  }
  if (!result && (provider === 'groq' || provider === 'auto')) {
    result = await tryProvider('Groq Vision', viaGroqVision);
  }

  if (!result) {
    throw new Error(`Все vision провайдеры упали:\n${errors.join('\n')}`);
  }

  // 3. Кэш
  setCache(imagePath, result);
  return { ...result, _fromCache: false };
}
