module.exports = {
  apps: [{
    name: 'smm-supplier-bot',
    script: 'agent/supplier-bot-cli.js',
    args: 'run coucou-events',
    cwd: '/root/smm-bot',
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    out_file: '/root/smm-bot/logs/supplier-bot-out.log',
    error_file: '/root/smm-bot/logs/supplier-bot-error.log',
    merge_logs: true,
    time: true,
  }],
};
