// agent/queue.js — фасад: выбирает бэкенд по QUEUE_BACKEND (json|sqlite)
//
// Все потребители (scanner, scheduler, cli) импортируют только этот файл
// и не знают про конкретную реализацию.
//
// Переключение: QUEUE_BACKEND=sqlite node cli.js scan

import * as jsonBackend from './queue-json.js';
import * as sqliteBackend from './queue-sqlite.js';

export function getBackendName() {
  const name = (process.env.QUEUE_BACKEND || 'json').toLowerCase();
  if (name !== 'json' && name !== 'sqlite') {
    throw new Error(`queue: неизвестный QUEUE_BACKEND="${name}" (json|sqlite)`);
  }
  return name;
}

function backend() {
  return getBackendName() === 'sqlite' ? sqliteBackend : jsonBackend;
}

export function enqueue(item) { return backend().enqueue(item); }
export function getById(id) { return backend().getById(id); }
export function getPending(opts) { return backend().getPending(opts); }
export function getUpcoming(opts) { return backend().getUpcoming(opts); }
export function getStats() { return backend().getStats(); }
export function updateItem(id, patch) { return backend().updateItem(id, patch); }
export function markPublished(id, postIds) { return backend().markPublished(id, postIds); }
export function markFailed(id, error) { return backend().markFailed(id, error); }
export function incrementAttempts(id) { return backend().incrementAttempts(id); }
export function cleanupOld(opts) { return backend().cleanupOld(opts); }
