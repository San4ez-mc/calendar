#!/usr/bin/env bash
# Деплой Fineko Calendar на VPS (повторні запуски: pull → install → схема БД → admin → restart).
# Перший запуск на сервері: див. DEPLOY.md (DNS, клон репо, .env, БД, nginx, SSL, SSO-клієнт).
set -euo pipefail

APP_DIR="/var/www/calendar.fineko.space"
cd "$APP_DIR"

echo "== Fineko Calendar deploy =="
git pull origin main
npm ci --no-audit --no-fund
npm run db:generate
npm run db:push          # лише адитивні зміни схеми; руйнівні перериваються (без --accept-data-loss)
npm run build:admin
pm2 startOrReload ecosystem.config.js --env production
pm2 save
sleep 2
curl -fsS http://127.0.0.1:4800/health && echo
echo "== Готово. pm2 logs calendar-api --lines 20 =="
