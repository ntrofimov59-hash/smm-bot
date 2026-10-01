// agent/suppliers/schemas.js — zod-схемы для базы поставщиков.
import { z } from 'zod';

export const CATEGORIES = [
  'venues',         // площадки, рестораны, банкетные залы
  'photographers',
  'videographers',
  'caterers',
  'decorators',
  'florists',
  'djs',
  'hosts',          // ведущие, тамада
  'musicians',      // живые группы, музыканты
  'makeup',         // визажисты, стилисты
  'transfer',       // трансфер, такси
  'entertainers',   // аниматоры, шоу
  'planners',       // организаторы
  'rental',         // аренда шатров, мебели, звука
  'other',
];

const PHONE_RE = /^[+\d][\d\s\-()]{6,20}$/;

export const SupplierSchema = z.object({
  id: z.string().min(3),
  name: z.string().min(1),
  category: z.enum(CATEGORIES),
  city: z.string().min(2).optional(),
  country: z.string().optional(),
  languages: z.array(z.string()).default([]),

  // Контакты
  phone: z.string().regex(PHONE_RE).optional(),
  email: z.string().email().optional(),
  instagram: z.string().optional(),
  telegram: z.string().optional(),
  website: z.string().url().optional(),

  // Характеристики
  priceRange: z.enum(['$', '$$', '$$$', '$$$$']).optional(),
  priceNote: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  rating: z.number().min(0).max(5).optional(),

  // Работа
  worksWithForeigners: z.boolean().default(false),
  paymentTerms: z.string().optional(),

  // Мета
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]),
  verified: z.boolean().default(false),
  source: z.string().default('manual'),
  sourceUrl: z.string().url().optional(),
  addedAt: z.string(),
  updatedAt: z.string(),
  projectsCount: z.number().int().min(0).default(0),
}).passthrough();

export const SuppliersFileSchema = z.object({
  version: z.number().int().default(1),
  category: z.enum(CATEGORIES),
  updatedAt: z.string().nullable().default(null),
  suppliers: z.array(SupplierSchema).default([]),
});

export class SupplierError extends Error {
  constructor(message, zodError = null) {
    super(message);
    this.name = 'SupplierError';
    this.zodErrors = zodError?.errors || null;
  }
}

export function formatZodError(err) {
  if (!err?.errors) return '';
  return err.errors.map(e => {
    const path = e.path.length ? e.path.join('.') : '(root)';
    return `  • ${path}: ${e.message}`;
  }).join('\n');
}
