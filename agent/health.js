// agent/health.js — HTTP сервер для healthcheck и мониторинга
// 0 зависимостей: только node:http. Endpoints: /health /status /metrics
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as queue from './queue.js';
import * as usage from './usage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _server = null;
let _startedAt = null;

function getVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function uptimeSeconds() {
  if (!_startedAt) return 0;
  return Math.floor((Date.now() - _startedAt) / 1000);
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getHealth() {
  const up = uptimeSeconds();
  return {
    status: 'ok',
    uptime: up,
    uptimeHuman: formatUptime(up),
    version: getVersion(),
  };
}

function getFullStatus() {
  let queueStats = null;
  let queueError = null;
  try {
    queueStats = queue.getStats();
  } catch (e) {
    queueError = e.message;
  }

  let usageStats = null;
  let usageError = null;
  try {
    usageStats = usage.getStatus();
  } catch (e) {
    usageError = e.message;
  }

  return {
    ...getHealth(),
    backend: (process.env.QUEUE_BACKEND || 'json').toLowerCase(),
    queue: queueStats || { error: queueError },
    usage: usageStats || { error: usageError },
  };
}

function prometheusMetrics() {
  const lines = [];
  const push = (name, help, type, value) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    lines.push(`${name} ${value}`);
  };

  push('smm_bot_uptime_seconds', 'Bot uptime in seconds', 'gauge', uptimeSeconds());

  try {
    const q = queue.getStats();
    push('smm_bot_queue_pending', 'Pending posts', 'gauge', q.pending || 0);
    push('smm_bot_queue_publishing', 'Publishing posts', 'gauge', q.publishing || 0);
    push('smm_bot_queue_published', 'Published posts', 'gauge', q.published || 0);
    push('smm_bot_queue_failed', 'Failed posts', 'gauge', q.failed || 0);
    push('smm_bot_queue_total', 'Total posts', 'gauge', q.total || 0);
  } catch {}

  try {
    const u = usage.getStatus();
    push('smm_bot_groq_tokens_today', 'Groq tokens used today', 'gauge', u.today?.groq_tokens || 0);
    push('smm_bot_gemini_requests_today', 'Gemini requests today', 'gauge', u.today?.gemini_requests || 0);
    push('smm_bot_posts_today', 'Posts published today', 'gauge', u.today?.posts || 0);
    push('smm_bot_cache_hits_today', 'Vision cache hits today', 'gauge', u.today?.cache_hits || 0);
  } catch {}

  return lines.join('\n') + '\n';
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

export function createHealthServer() {
  return http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'method_not_allowed' });
    }

    if (url === '/health' || url === '/healthz') return sendJson(res, 200, getHealth());
    if (url === '/status') return sendJson(res, 200, getFullStatus());
    if (url === '/metrics') return sendText(res, 200, prometheusMetrics(), 'text/plain; version=0.0.4; charset=utf-8');
    if (url === '/' || url === '/index.html') {
      return sendText(res, 200, 'SMM Bot. Endpoints: /health /status /metrics\n');
    }

    return sendJson(res, 404, { error: 'not_found', path: url });
  });
}

export function startHealthServer({ port, host } = {}) {
  if (_server) return Promise.resolve(_server);

  // Приоритет: явный аргумент > env > дефолт 3000
  let p;
  if (port !== undefined) {
    p = Number(port);
  } else {
    const envPort = process.env.HEALTH_PORT;
    if (envPort === undefined) {
      p = 3000;
    } else if (envPort === '0' || envPort === 'off' || envPort === 'false') {
      console.log(`💤 health server отключён (HEALTH_PORT=${envPort})`);
      return Promise.resolve(null);
    } else {
      p = Number(envPort);
    }
  }

  const h = host ?? process.env.HEALTH_HOST ?? '0.0.0.0';

  _startedAt = Date.now();
  _server = createHealthServer();

  return new Promise((resolve, reject) => {
    _server.once('error', reject);
    _server.listen(p, h, () => {
      const addr = _server.address();
      console.log(`💚 Health server: http://${h}:${addr.port}/health`);
      console.log(`   Status:  http://${h}:${addr.port}/status`);
      console.log(`   Metrics: http://${h}:${addr.port}/metrics`);
      resolve(_server);
    });
  });
}

export function stopHealthServer() {
  if (!_server) return Promise.resolve();
  const s = _server;
  _server = null;
  _startedAt = null;
  return new Promise(resolve => s.close(() => resolve()));
}

export function getHealthServer() {
  return _server;
}
