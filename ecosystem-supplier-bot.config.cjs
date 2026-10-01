// DEPRECATED: supplier bot теперь поднимается внутри bot.js (ENABLE_SUPPLIER_BOT=1).
// Не запускай этот файл параллельно — будет конфликт getUpdates на одном токене.
//
// Миграция:
//   pm2 stop smm-supplier-bot && pm2 delete smm-supplier-bot
//   pm2 restart smm-bot --update-env
//
module.exports = {
  apps: [],
};
