// agent/suppliers/store.js — работа с файлами projects/<slug>/suppliers/<category>.json

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CATEGORIES, SuppliersFileSchema, SupplierSchema, SupplierError, formatZodError } from './schemas.js';

function suppliersDir(projectPath) {
  return path.join(projectPath, 'suppliers');
}

function filePath(projectPath, category) {
  if (!CATEGORIES.includes(category)) {
    throw new SupplierError(`Неизвестная категория: ${category}`);
  }
  return path.join(suppliersDir(projectPath), `${category}.json`);
}

export function loadCategory(projectPath, category) {
  const file = filePath(projectPath, category);
  if (!fs.existsSync(file)) {
    return { version: 1, category, updatedAt: null, suppliers: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const r = SuppliersFileSchema.safeParse(raw);
    if (!r.success) {
      throw new SupplierError(`Невалидный ${file}:\n${formatZodError(r.error)}`);
    }
    return r.data;
  } catch (e) {
    if (e instanceof SupplierError) throw e;
    throw new SupplierError(`Ошибка чтения ${file}: ${e.message}`, e);
  }
}

export function saveCategory(projectPath, category, data) {
  const dir = suppliersDir(projectPath);
  fs.mkdirSync(dir, { recursive: true });
  const file = filePath(projectPath, category);
  const tmp = file + '.tmp';
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function normalizePhone(p) {
  if (!p) return null;
  return String(p).replace(/\D/g, '');
}

function normalizeName(n) {
  return String(n || '').toLowerCase().trim().replace(/\s+/g, ' ');
}


function sanitizeContactFields(supplier) {
  // phone: только если похож на телефон, иначе убрать (OSM часто даёт мусор)
  if (supplier.phone) {
    const digits = String(supplier.phone).replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
      delete supplier.phone;
    } else {
      // оставляем как есть, если проходит мягкий паттерн
      const ok = /^[+\d][\d\s\-()]{6,20}$/.test(String(supplier.phone));
      if (!ok) delete supplier.phone;
    }
  }
  if (supplier.email) {
    const e = String(supplier.email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) delete supplier.email;
    else supplier.email = e;
  }
  if (supplier.website) {
    let w = String(supplier.website).trim();
    if (w && !/^https?:\/\//i.test(w)) w = 'https://' + w;
    try {
      const u = new URL(w);
      if (!['http:', 'https:'].includes(u.protocol)) delete supplier.website;
      else supplier.website = u.toString();
    } catch {
      delete supplier.website;
    }
  }
  if (supplier.sourceUrl) {
    try { new URL(supplier.sourceUrl); } catch { delete supplier.sourceUrl; }
  }
  return supplier;
}

export function findDuplicate(list, candidate) {
  const phone = normalizePhone(candidate.phone);
  const name = normalizeName(candidate.name);
  const city = String(candidate.city || '').toLowerCase();

  return list.find(s => {
    if (phone && normalizePhone(s.phone) === phone) return true;
    if (name && normalizeName(s.name) === name &&
        String(s.city || '').toLowerCase() === city) return true;
    return false;
  });
}

export function addSupplier(projectPath, input) {
  const category = input.category;
  if (!category) throw new SupplierError('Нужен category');

  const data = loadCategory(projectPath, category);

  const now = new Date().toISOString();
  const supplier = {
    id: `s-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    name: input.name || '(без названия)',
    category,
    city: input.city || null,
    country: input.country || null,
    languages: input.languages || [],
    phone: input.phone || null,
    email: input.email || null,
    instagram: input.instagram || null,
    telegram: input.telegram || null,
    website: input.website || null,
    priceRange: input.priceRange || null,
    priceNote: input.priceNote || null,
    capacity: input.capacity || null,
    rating: input.rating || null,
    worksWithForeigners: !!input.worksWithForeigners,
    paymentTerms: input.paymentTerms || null,
    notes: input.notes || null,
    tags: input.tags || [],
    verified: !!input.verified,
    source: input.source || 'manual',
    sourceUrl: input.sourceUrl || null,
    addedAt: now,
    updatedAt: now,
    projectsCount: 0,
  };

  // Нормализация: null → undefined для опциональных полей
  const OPTIONAL_FIELDS = [
    'city', 'country', 'phone', 'email', 'instagram', 'telegram', 'website',
    'priceRange', 'priceNote', 'capacity', 'rating',
    'paymentTerms', 'notes', 'sourceUrl',
  ];
  for (const f of OPTIONAL_FIELDS) {
    if (supplier[f] === null || supplier[f] === '') supplier[f] = undefined;
  }

  // priceRange: принимаем как '$'-'$$$$' или как количество $ (1-4)
  if (supplier.priceRange !== undefined) {
    const pr = String(supplier.priceRange).trim();
    if (/^\$+$/.test(pr) && pr.length <= 4) {
      supplier.priceRange = pr;
    } else {
      const n = Number(pr.replace(/[^0-9]/g, ''));
      if (n >= 1 && n <= 4) supplier.priceRange = '$'.repeat(n);
      else supplier.priceRange = undefined;
    }
  }

  // capacity/rating: строка → число
  if (supplier.capacity !== undefined) {
    const n = Number(supplier.capacity);
    supplier.capacity = Number.isFinite(n) && n > 0 ? n : undefined;
  }
  if (supplier.rating !== undefined) {
    const n = Number(supplier.rating);
    supplier.rating = Number.isFinite(n) && n >= 0 && n <= 5 ? n : undefined;
  }

  // Убираем undefined из объекта — zod всё равно подставит дефолты
  for (const f of OPTIONAL_FIELDS) {
    if (supplier[f] === undefined) delete supplier[f];
  }

  sanitizeContactFields(supplier);

  // Валидация
  const r = SupplierSchema.safeParse(supplier);
  if (!r.success) {
    throw new SupplierError(`Невалидные данные:\n${formatZodError(r.error)}`);
  }

  // Дедуп
  const dup = findDuplicate(data.suppliers, supplier);
  if (dup) {
    throw new SupplierError(`Дубликат: ${dup.name} (${dup.id})`);
  }

  data.suppliers.push(r.data);
  saveCategory(projectPath, category, data);
  return r.data;
}

export function getSupplier(projectPath, id) {
  for (const cat of CATEGORIES) {
    const file = filePath(projectPath, cat);
    if (!fs.existsSync(file)) continue;
    try {
      const data = loadCategory(projectPath, cat);
      const s = data.suppliers.find(x => x.id === id);
      if (s) return s;
    } catch { /* skip broken */ }
  }
  return null;
}

export function updateSupplier(projectPath, id, patch) {
  for (const cat of CATEGORIES) {
    const file = filePath(projectPath, cat);
    if (!fs.existsSync(file)) continue;
    const data = loadCategory(projectPath, cat);
    const idx = data.suppliers.findIndex(x => x.id === id);
    if (idx === -1) continue;

    const merged = {
      ...data.suppliers[idx],
      ...patch,
      id: data.suppliers[idx].id,
      category: data.suppliers[idx].category,
      updatedAt: new Date().toISOString(),
    };

    // Та же нормализация, что и в addSupplier
    const OPTIONAL_FIELDS = [
      'city', 'country', 'phone', 'email', 'instagram', 'telegram', 'website',
      'priceRange', 'priceNote', 'capacity', 'rating',
      'paymentTerms', 'notes', 'sourceUrl',
    ];
    for (const f of OPTIONAL_FIELDS) {
      if (merged[f] === null || merged[f] === '') merged[f] = undefined;
    }
    if (merged.priceRange !== undefined) {
      const pr = String(merged.priceRange).trim();
      if (/^\$+$/.test(pr) && pr.length <= 4) merged.priceRange = pr;
      else {
        const n = Number(pr.replace(/[^0-9]/g, ''));
        merged.priceRange = (n >= 1 && n <= 4) ? '$'.repeat(n) : undefined;
      }
    }
    if (merged.capacity !== undefined) {
      const n = Number(merged.capacity);
      merged.capacity = Number.isFinite(n) && n > 0 ? n : undefined;
    }
    if (merged.rating !== undefined) {
      const n = Number(merged.rating);
      merged.rating = Number.isFinite(n) && n >= 0 && n <= 5 ? n : undefined;
    }
    for (const f of OPTIONAL_FIELDS) {
      if (merged[f] === undefined) delete merged[f];
    }

    sanitizeContactFields(merged);

    const r = SupplierSchema.safeParse(merged);
    if (!r.success) {
      throw new SupplierError(`Невалидные данные:\n${formatZodError(r.error)}`);
    }
    data.suppliers[idx] = r.data;
    saveCategory(projectPath, cat, data);
    return r.data;
  }
  return null;
}

export function removeSupplier(projectPath, id) {
  for (const cat of CATEGORIES) {
    const file = filePath(projectPath, cat);
    if (!fs.existsSync(file)) continue;
    const data = loadCategory(projectPath, cat);
    const before = data.suppliers.length;
    data.suppliers = data.suppliers.filter(x => x.id !== id);
    if (data.suppliers.length < before) {
      saveCategory(projectPath, cat, data);
      return true;
    }
  }
  return false;
}

export function listAll(projectPath, { category = null, city = null, onlyVerified = false } = {}) {
  const cats = category ? [category] : CATEGORIES;
  const out = [];
  for (const cat of cats) {
    const file = filePath(projectPath, cat);
    if (!fs.existsSync(file)) continue;
    try {
      const data = loadCategory(projectPath, cat);
      for (const s of data.suppliers) {
        if (city && String(s.city || '').toLowerCase() !== city.toLowerCase()) continue;
        if (onlyVerified && !s.verified) continue;
        out.push(s);
      }
    } catch { /* skip */ }
  }
  return out;
}

export function stats(projectPath) {
  const result = {};
  let total = 0;
  for (const cat of CATEGORIES) {
    const file = filePath(projectPath, cat);
    if (!fs.existsSync(file)) continue;
    try {
      const data = loadCategory(projectPath, cat);
      result[cat] = data.suppliers.length;
      total += data.suppliers.length;
    } catch { /* skip */ }
  }
  return { total, byCategory: result };
}

export { CATEGORIES };
