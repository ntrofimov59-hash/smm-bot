// agent/outreach/drafter.js — персональный черновик первого сообщения.
// Использует Groq (OpenAI SDK). Ничего не отправляет — только текст.

import OpenAI from 'openai';

const groq = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  : null;

const MODEL = process.env.OUTREACH_MODEL || 'openai/gpt-oss-120b';

const SEGMENT_LABEL = {
  venue: { ru: 'площадка', en: 'venue', es: 'lugar', hy: 'վայր' },
  agency: { ru: 'event-агентство', en: 'event agency', es: 'agencia', hy: 'գործակալություն' },
  caterer: { ru: 'кейтеринг', en: 'caterer', es: 'catering', hy: 'քեյթերինգ' },
  corporate: { ru: 'компания', en: 'company', es: 'empresa', hy: 'ընկերություն' },
  contractor: { ru: 'подрядчик', en: 'contractor', es: 'proveedor', hy: 'կապալառու' },
  other: { ru: 'партнёр', en: 'partner', es: 'socio', hy: 'գործընկեր' },
};

const SYSTEM = {
  ru: `Ты помогаешь основателю Coucou Events писать персональные первые сообщения потенциальным партнёрам.
Стиль: живой, тёплый, деловой. Без канцелярита. 2-3 коротких абзаца.
Структура:
1) Кто мы (Coucou Events — организация мероприятий под ключ, 10 городов, свадьбы, корпоративы, кейтеринг, шатры).
2) Почему пишем именно им (упомяни их тип и город).
3) Простая просьба: 15-минутный звонок или короткое обсуждение.
Без emoji. Без восклицательных знаков. Без шаблонных "надеюсь на сотрудничество". Не пиши "мы ищем" — пиши "мы формируем пул". Подпись: «Команда Coucou Events».`,
  en: `You help the founder of Coucou Events write personal first messages to potential partners.
Style: warm, business-like, no jargon. 2-3 short paragraphs.
Structure:
1) Who we are (Coucou Events — turn-key event planning, 10 cities, weddings, corporates, catering, tents).
2) Why we're writing to them (mention their type and city).
3) Simple ask: a 15-minute call or a short chat.
No emoji. No exclamation marks. No template phrases like "looking forward to cooperation". Sign: "Coucou Events team".`,
  es: `Ayudas al fundador de Coucou Events a escribir primeros mensajes personales a posibles socios.
Estilo: cercano, profesional, sin jerga. 2-3 párrafos cortos.
Estructura:
1) Quiénes somos (Coucou Events — organización integral de eventos, 10 ciudades, bodas, corporativos, catering, carpas).
2) Por qué escribimos a ellos (menciona su tipo y ciudad).
3) Petición simple: una llamada de 15 minutos o una charla breve.
Sin emojis. Sin signos de exclamación. Firma: "Equipo de Coucou Events".`,
  hy: `Դու օգնում ես Coucou Events-ի հիմնադրին գրել անհատական առաջին հաղորդագրություններ հնարավոր գործընկերներին։
Ոճ՝ ջերմ, գործնական, առանց գրասենյակային լեզվի։ 2-3 կարճ պարբերություն։
Կառուցվածք։
1) Ով ենք մենք (Coucou Events — միջոցառումների ամբողջական կազմակերպում, 10 քաղաք, հարսանիքներ, կորպորատիվներ, քեյթերինգ, վրաններ)։
2) Ինչու ենք գրում հենց նրանց (նշիր տեսակը և քաղաքը)։
3) Պարզ խնդրանք՝ 15 րոպեանոց զանգ կամ կարճ քննարկում։
Առանց էմոջիների։ Առանց բացականչական նշանների։ Ստորագրություն՝ «Coucou Events թիմ»։`,
};

/**
 * @param {Object} candidate
 * @param {Object} project      — project.json (бренд, языки)
 * @param {string} lang         — 'ru'|'en'|'es'|'hy' (default: candidate.language)
 * @returns {Promise<{ok, text, tokens, lang}|{ok:false, error}>}
 */
export async function draftOutreach(candidate, project, lang = null) {
  if (!groq) {
    return { ok: false, error: 'GROQ_API_KEY не задан в .env' };
  }
  const useLang = lang || candidate.language || 'ru';
  const segment = candidate.segment || 'other';
  const segmentLabel = (SEGMENT_LABEL[segment] || SEGMENT_LABEL.other)[useLang] || segment;

  const userPrompt = [
    `Кому пишем:`,
    `- Название: ${candidate.name}`,
    `- Тип: ${segmentLabel}`,
    `- Город: ${candidate.city || '—'}`,
    `- Язык ответа: ${useLang}`,
    candidate.website ? `- Сайт: ${candidate.website}` : '',
    candidate.instagram ? `- Instagram: ${candidate.instagram}` : '',
    candidate.notes ? `- Заметки: ${candidate.notes}` : '',
    '',
    `Напиши одно персональное первое сообщение на ${useLang}.`,
    `Не пиши длинно. Не более 700 символов.`,
  ].filter(Boolean).join('\n');

  try {
    const res = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM[useLang] || SYSTEM.ru },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 400,
    });
    const text = res.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false, error: 'пустой ответ от LLM' };
    return {
      ok: true,
      text,
      lang: useLang,
      tokens: res.usage?.total_tokens || 0,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
