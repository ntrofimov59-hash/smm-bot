// agent/schemas.js — zod-схемы для конфигов проекта
import { z } from 'zod';

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const LandmarkSchema = z.object({
  name: z.string().min(1),
  hashtag: z.string().startsWith('#'),
  type: z.string().optional(),
}).passthrough();

export const CitySchema = z.object({
  displayName: z.string().min(1),
  country: z.string().optional(),
  tags: z.array(z.string()).default([]),
  hashtags: z.array(z.string().startsWith('#')).default([]),
  landmarks: z.array(LandmarkSchema).default([]),
  nearby: z.array(z.string()).default([]),
  searchQueries: z.array(z.string()).default([]),
  pinterestBoards: z.array(z.string().url()).default([]),
}).passthrough();

export const ProjectSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, {
    message: 'slug: только a-z, 0-9, дефис; начинается с буквы/цифры',
  }),
  timezone: z.string().refine(tz => {
    if (!tz || typeof tz !== 'string') return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
    catch { return false; }
  }, { message: 'timezone: неизвестная IANA-зона (например "Asia/Yerevan", "UTC")' }),
  languages: z.array(z.string().min(2).max(5)).min(1).default(['ru']),

  brand: z.object({
    tone: z.string().optional(),
    voice: z.string().optional(),
    emoji: z.string().optional(),
    avoid: z.array(z.string()).default([]),
    signature: z.string().optional(),
  }).default({}),

  publishing: z.object({
    bestHours: z.array(z.string().regex(HHMM_RE, {
      message: 'bestHours: ожидается "HH:MM" в 24-часовом формате',
    })).min(1, { message: 'bestHours: нужен хотя бы один час' }),
    postsPerDay: z.number().int().positive().optional(),
    minHoursBetweenPosts: z.number().positive().default(4),
    maxHashtags: z.number().int().min(1).max(30).default(12),
  }),

  cities: z.record(z.string(), CitySchema).default({}),

  hashtags: z.object({
    base: z.array(z.string().startsWith('#')).default([]),
    cities: z.record(z.string(), z.array(z.string().startsWith('#'))).default({}),
    services: z.record(z.string(), z.array(z.string().startsWith('#'))).default({}),
  }).default({}),

  imageProcessing: z.object({
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    quality: z.number().int().min(1).max(100).optional(),
    variation: z.object({
      enabled: z.boolean().default(false),
      profile: z.enum(['subtle', 'medium', 'strong']).default('subtle'),
    }).default({ enabled: false, profile: 'subtle' }),
  }).passthrough().optional(),
}).passthrough();

export const InstagramAccountSchema = z.object({
  username: z.string().min(1),
  igUserId: z.string().min(1),
  accessToken: z.string().min(3, { message: 'accessToken: слишком короткий (минимум 3 символа)' }),
  city: z.string().optional(),
  cityTags: z.array(z.string()).default([]),
  active: z.boolean().default(true),
  refreshedAt: z.string().optional(),
  expiresIn: z.number().int().optional(),
});

export const AccountsSchema = z.object({
  instagram: z.array(InstagramAccountSchema).default([]),
  facebook: z.array(z.any()).optional(),
  threads: z.array(z.any()).optional(),
}).passthrough();

export class ConfigError extends Error {
  constructor(kind, file, zodError) {
    const lines = zodError.errors.map(e => {
      const path = e.path.length ? e.path.join('.') : '(root)';
      return `  • ${path}: ${e.message}`;
    });
    super(`❌ ${kind} — ошибки валидации в ${file}:\n${lines.join('\n')}`);
    this.name = 'ConfigError';
    this.kind = kind;
    this.file = file;
    this.zodErrors = zodError.errors;
  }
}
