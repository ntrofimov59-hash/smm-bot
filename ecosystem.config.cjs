module.exports = {
  apps: [{
    name: 'smm-bot',
    script: './bot.js',
    node_args: '-r dotenv/config',
    env: {
      NODE_ENV: 'production',
    },
    max_restarts: 10,
    restart_delay: 5000,
    autorestart: true,
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
