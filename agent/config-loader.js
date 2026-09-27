// agent/config-loader.js — безопасная загрузка конфигов с валидацией
import fs from 'fs';
import path from 'path';
import { ProjectSchema, AccountsSchema, ConfigError } from './schemas.js';

export function loadProject(projectPath) {
  const file = path.join(projectPath, 'project.json');
  if (!fs.existsSync(file)) {
    throw new Error(`project.json не найден: ${file}`);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`project.json: невалидный JSON (${e.message})`, { cause: e });
  }
  const r = ProjectSchema.safeParse(raw);
  if (!r.success) throw new ConfigError('project.json', file, r.error);
  return r.data;
}

export function loadAccounts(projectPath) {
  const file = path.join(projectPath, 'accounts.json');
  if (!fs.existsSync(file)) {
    // accounts.json опционально: проект может быть без настроенных аккаунтов
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`accounts.json: невалидный JSON (${e.message})`, { cause: e });
  }
  const r = AccountsSchema.safeParse(raw);
  if (!r.success) throw new ConfigError('accounts.json', file, r.error);
  return r.data;
}
