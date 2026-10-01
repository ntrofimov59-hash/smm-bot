// agent/outreach/sources/spyur.js — Spyur.am (армянский каталог).
// Первая версия — ручной CSV: скачал, сконвертировал в manual.json.
// Автоматический парсинг отложен (риск блокировки датацентра IP).
//
// Альтернатива: использовать Google Places с regionCode=AM — покрывает много армянских бизнесов.

export async function searchSpyur() {
  throw new Error('spyur: автоматический парсинг не реализован. Используй Google Places (regionCode=AM) или manual.json');
}
