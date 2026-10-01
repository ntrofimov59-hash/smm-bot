#!/usr/bin/env node
// agent/suppliers-discovery-cli.js — авто-наполнение базы поставщиков.
//
// Использование:
//   node agent/suppliers-discovery-cli.js run <project> [--city yerevan] [--category photographers]
//   node agent/suppliers-discovery-cli.js daily <project>

import 'dotenv/config';
import path from 'path';
import { discover } from './suppliers-discovery/index.js';

function projectPath(slug) {
  const root = process.env.PROJECTS_ROOT
    ? path.resolve(process.env.PROJECTS_ROOT)
    : path.resolve(new URL('../projects/', import.meta.url).pathname);
  return path.join(root, slug);
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v && !v.startsWith('--')) { args.flags[k] = v; i++; }
      else args.flags[k] = true;
    } else args._.push(a);
  }
  return args;
}

async function main() {
  const [cmd, slug, ...rest] = process.argv.slice(2);
  if (!cmd || !slug) {
    console.log(`suppliers-discovery-cli — команды:

  run <project> [--city yerevan] [--category photographers] [--cities yerevan,tbilisi]
  daily <project>     — обход всех городов и категорий

Примеры:
  node agent/suppliers-discovery-cli.js run coucou-events --city yerevan
  node agent/suppliers-discovery-cli.js run coucou-events --city yerevan --category photographers
  node agent/suppliers-discovery-cli.js daily coucou-events
`);
    process.exit(cmd ? 1 : 0);
  }

  const args = parseArgs(rest);
  const p = projectPath(slug);

  let cities = null;
  let categories = null;

  if (cmd === 'run') {
    if (args.flags.city) cities = [args.flags.city];
    if (args.flags.cities) cities = String(args.flags.cities).split(',').map(s => s.trim());
    if (args.flags.category) categories = [args.flags.category];
    if (args.flags.categories) categories = String(args.flags.categories).split(',').map(s => s.trim());
  }

  console.log(`🚀 Discovery: ${cmd}`);
  if (cities) console.log(`   cities: ${cities.join(', ')}`);
  if (categories) console.log(`   categories: ${categories.join(', ')}`);
  else console.log(`   categories: all`);
  console.log('');

  const stats = await discover({
    projectPath: p,
    cities,
    categories,
    onLog: console.log,
  });

  console.log(`\n📊 Итог: ${JSON.stringify(stats)}`);
}

main();
