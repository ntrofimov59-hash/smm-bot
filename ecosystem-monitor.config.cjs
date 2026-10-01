module.exports = {
  apps: [{
    name: 'smm-telegram-monitor',
    script: 'agent/telegram-monitor-cli.js',
    args: 'run coucou-events',
    cwd: '/root/smm-bot',
    interpreter: 'node',
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    out_file: '/root/smm-bot/logs/telegram-monitor-out.log',
    error_file: '/root/smm-bot/logs/telegram-monitor-error.log',
    merge_logs: true,
    time: true,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
