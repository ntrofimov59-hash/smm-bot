#!/usr/bin/env node
// scripts/brand-assets.mjs — генерит все производные ребрендинга из 6 исходных PNG.
// Запуск (из корня smm-bot):
//   node scripts/brand-assets.mjs --src ~/brand --site /path/to/coucou_events --bot .
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const SRC = path.resolve(opt('--src', 'brand-src'));
const SITE = opt('--site') ? path.resolve(opt('--site')) : null;
const BOT = path.resolve(opt('--bot', '.'));

const FILES = {
  tab: 'coucou-bird-3d.png',            // вкладка браузера
  search: 'coucou-bird-flat.png',       // выдача поиска
  full: 'coucou-logo-full-dusty.png',   // хедер + мега-меню
  mark: 'logo.png',                     // хедер при скролле
  wmBird: 'coucou-bird-flat-white.png', // вотермарка (птица)
  wmFull: 'coucou-logo-full-white.png', // вотермарка (полный логотип)
};
for (const f of Object.values(FILES)) {
  if (!fs.existsSync(path.join(SRC, f))) { console.error(`✗ нет файла: ${path.join(SRC, f)}`); process.exit(1); }
}

/** Обрезает прозрачные поля по alpha-каналу */
async function trim(file) {
  const p = path.join(SRC, file);
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return sharp(p).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toBuffer();
}

async function square(buf, size, { pad = 0.08, bg = { r: 0, g: 0, b: 0, alpha: 0 } } = {}) {
  const inner = Math.round(size * (1 - 2 * pad));
  const r = await sharp(buf).resize(inner, inner, { fit: 'inside' }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: r, gravity: 'center' }])
    .png({ compressionLevel: 9 }).toBuffer();
}

/** ICO с PNG внутри (поддерживают все современные браузеры) */
function ico(pngs) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const dir = pngs.map(({ size, buf }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12);
    offset += buf.length; return e;
  });
  return Buffer.concat([head, ...dir, ...pngs.map((p) => p.buf)]);
}

const write = (p, buf) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  console.log(`✓ ${p} (${(buf.length / 1024).toFixed(1)} KB)`);
};

const tab = await trim(FILES.tab);
const search = await trim(FILES.search);
const full = await trim(FILES.full);
const mark = await trim(FILES.mark);
const wmBird = await trim(FILES.wmBird);
const wmFull = await trim(FILES.wmFull);

if (SITE) {
  const pub = path.join(SITE, 'public');
  const t16 = await square(tab, 16, { pad: 0.02 });
  const t32 = await square(tab, 32, { pad: 0.03 });
  const t48 = await square(tab, 48, { pad: 0.04 });
  write(path.join(pub, 'favicon-16.png'), t16);
  write(path.join(pub, 'favicon-32.png'), t32);
  write(path.join(pub, 'favicon.ico'), ico([{ size: 16, buf: t16 }, { size: 32, buf: t32 }, { size: 48, buf: t48 }]));
  write(path.join(pub, 'apple-touch-icon.png'), await square(tab, 180, { pad: 0.14, bg: { r: 255, g: 255, b: 255, alpha: 1 } }));
  // Поиск: Google берёт иконку кратную 48px
  for (const s of [48, 96, 192]) write(path.join(pub, `favicon-flat-${s}.png`), await square(search, s, { pad: 0.1 }));
  write(path.join(pub, 'brand/logo-512.png'), await square(search, 512, { pad: 0.1 }));
  write(path.join(pub, 'brand/logo-full.png'), await sharp(full).resize({ width: 640 }).png({ compressionLevel: 9 }).toBuffer());
  write(path.join(pub, 'brand/logo-mark.png'), await sharp(mark).resize({ width: 256 }).png({ compressionLevel: 9 }).toBuffer());
}

const assets = path.join(BOT, 'projects/coucou-events/assets');
write(path.join(assets, 'logo-white.png'), await sharp(wmBird).resize({ height: 256 }).png({ compressionLevel: 9 }).toBuffer());
write(path.join(assets, 'logo-full-white.png'), await sharp(wmFull).resize({ width: 800 }).png({ compressionLevel: 9 }).toBuffer());
console.log('\nГотово.');
