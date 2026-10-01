function waLink(phone) {
  const clean = String(phone).replace(/\D/g, '');
  return clean ? `https://wa.me/${clean}` : null;
}

function igLink(handle) {
  const h = String(handle || '').replace(/^@/, '').replace(/^https?:\/\/(?:www\.)?instagram\.com\//, '').replace(/\/$/, '');
  return /^[A-Za-z0-9._]+$/.test(h) ? `https://instagram.com/${h}` : null;
}

function tgLink(handle) {
  const h = String(handle || '').replace(/^@/, '');
  return /^[A-Za-z0-9_]{4,}$/.test(h) ? `https://t.me/${h}` : null;
}

export function formatReply(query, result) {
  const { category, city } = query;

  if (!result.ok) {
    return '🤔 Не понял, кого искать. Напиши, например:\n' +
      '<i>нужен фотограф в Ереване</i>\n' +
      '<i>кейтеринг тбилиси на 100 гостей</i>\n' +
      '<i>диджей на бали</i>';
  }

  if (!result.list.length) {
    return `😕 Пока нет поставщиков в категории <b>${category}</b>${city ? ' в ' + city : ''}.\n\n` +
      `Добавь через CLI:\n<code>node agent/suppliers-cli.js add coucou-events --category ${category} --name "..." --city ${city || 'yerevan'} --phone ...</code>`;
  }

  const lines = [];
  const head = city
    ? `🎯 <b>${category}</b> — ${city}`
    : `🎯 <b>${category}</b>`;
  lines.push(head);

  if (result.usedFallback) {
    lines.push(`<i>в ${city} не нашлось, показал по другим городам</i>`);
  }
  lines.push('');

  for (let i = 0; i < result.list.length; i++) {
    const s = result.list[i];
    lines.push(`<b>${i + 1}. ${s.name}</b>${s.verified ? ' ✅' : ''}`);
    if (s.city) lines.push(`📍 ${s.city}`);
    if (s.priceRange) lines.push(`💰 ${s.priceRange}${s.priceNote ? ' · ' + s.priceNote : ''}`);
    if (s.rating) lines.push(`⭐ ${s.rating}`);
    if (s.capacity) lines.push(`👥 до ${s.capacity}`);
    if (s.languages?.length) lines.push(`🗣 ${s.languages.join(', ')}`);
    if (s.worksWithForeigners) lines.push(`🌍 работает с иностранцами`);
    if (s.phone) {
      const wa = waLink(s.phone);
      lines.push(`📞 ${wa ? `<a href="${wa}">${s.phone}</a>` : s.phone}`);
    }
    if (s.instagram) {
      const ig = igLink(s.instagram);
      lines.push(`📷 ${ig ? `<a href="${ig}">${s.instagram}</a>` : s.instagram}`);
    }
    if (s.telegram) {
      const tg = tgLink(s.telegram);
      lines.push(`✈️ ${tg ? `<a href="${tg}">${s.telegram}</a>` : s.telegram}`);
    }
    if (s.email) lines.push(`✉️ ${s.email}`);
    if (s.website) lines.push(`🌐 <a href="${s.website}">${s.website}</a>`);
    if (s.notes) lines.push(`📝 ${s.notes}`);
    lines.push('');
  }

  if (result.total > result.list.length) {
    lines.push(`<i>...всего найдено ${result.total}, показал ${result.list.length}</i>`);
  }

  return lines.join('\n');
}
