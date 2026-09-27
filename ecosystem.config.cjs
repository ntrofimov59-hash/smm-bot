module.exports = {
  apps: [{
    name: 'smm-bot',
    script: './bot.js',
    cwd: '/root/smm-bot',
    node_args: '-r dotenv/config',
    env: {
      NODE_ENV: 'production',
      DOTENV_CONFIG_PATH: '/root/smm-bot/.env',
    },
    max_restarts: 10,
    restart_delay: 5000,
    autorestart: true,
  }],
};
