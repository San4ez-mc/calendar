# Fineko Calendar — перший деплой на VPS (calendar.fineko.space)

> Сервер `root@173.242.62.180`. Усе нижче робиться ОДИН раз; далі лише `bash deploy.sh` на сервері.
> Порт сервісу **4850** (локально й на проді). База `fineko_calendar` у спільному Postgres.

## 0. Що потрібно від власника
1. **DNS:** A-запис `calendar.fineko.space` → `173.242.62.180`.
2. **GitHub:** порожній репозиторій `San4ez-mc/calendar` (локальний уже має коміт; `git remote add origin … && git push -u origin main`).
3. Слово **«деплой»** (нове; вікно деплою Flows 21:00–08:00 для календаря не обов'язкове, бо він не чіпає сервіси воронок, але SSO перезапускається коротко).

## 1. Сервер: код і база
```bash
ssh root@173.242.62.180
cd /var/www && git clone https://github.com/San4ez-mc/calendar.git calendar.fineko.space
cd calendar.fineko.space
sudo -u postgres psql -c "CREATE DATABASE fineko_calendar"          # або через psql як для інших баз
cp .env.example .env                                                  # і заповнити (див. нижче)
```
`.env` на проді:
```
PORT=4850
NODE_ENV=production
DATABASE_URL=postgresql://<user>:<pass>@127.0.0.1:5432/fineko_calendar
SSO_URL=https://sso.fineko.space
SSO_CLIENT_ID=<clientId з кроку 3>
SSO_CLIENT_SECRET=<clientSecret з кроку 3>
SSO_REDIRECT_URI=https://calendar.fineko.space/auth/callback
ADMIN_BASE_URL=https://calendar.fineko.space
ALLOWED_ORIGINS=https://calendar.fineko.space
MCP_SECRET=<openssl rand -hex 24>
```
Далі: `bash deploy.sh` (перший раз до `pm2 startOrReload` усе ставиться само), потім `npm run db:seed -- --show-key` (компанія «Олександр Мацук (FINEKO)», співробітник, послуга «Консультація», **Пн–Пт 11:00–18:00**, друкує apiKey лише в консоль сервера).

## 2. nginx + SSL
```bash
cp deploy/nginx-calendar.conf /etc/nginx/sites-available/calendar.fineko.space
ln -s /etc/nginx/sites-available/calendar.fineko.space /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d calendar.fineko.space      # коли DNS уже резолвиться
```

## 3. SSO
1. Зареєструвати OAuth-клієнта (на проді, ключ `ADMIN_API_KEY` з `.env` SSO):
   `POST https://sso.fineko.space/admin/clients` `x-admin-key: …` тіло `{"name":"calendar","redirectUris":["https://calendar.fineko.space/auth/callback"]}` → `clientId`, `clientSecret` у `.env` календаря.
2. Задеплоїти SSO з новим рядком у реєстрі продуктів (`src/index.ts`, `key:'calendar'`, коміт у репо SSO): `git pull && pm2 restart sso`. У `.env` SSO можна задати `CALENDAR_URL=http://127.0.0.1:4850` (каталог проєктів/сторінок краще брати локально).
3. У панелі доступів SSO видати собі роль **superadmin** у продукті «Календар» (далі людям компаній: роль user + проєкт = компанія).

## 4. Перевірка
```bash
CAL_URL=https://calendar.fineko.space CAL_KEY=<apiKey> node scripts/smoke.js     # 19 перевірок, MCP по HTTP теж
```
У браузері: вхід через FINEKO → місяць (будні «вільно 7г») → день (зелені віконця 11–18).

## 5. Підключити воронки (Flows)
```bash
cd /var/www/flows.fineko.space/platform && git pull origin main
CAL_URL=https://calendar.fineko.space CAL_KEY=<apiKey> CAL_SERVICE_ID=<id послуги з seed> \
  PLATFORM_ROOT=$PWD node scripts/patch-calendar-booking-2026-11-04.js      # DRY_RUN=1 спершу
```
Підключає `sell-ai-seller` (після пропозиції) і `bot-karta-sales` (після оплати): бот показує віконця, людина обирає цифрою, запис іде в календар, власнику приходить сповіщення.

## Відкат
`pm2 stop calendar-api` — воронки не ламаються: вузол «Календар: вільні віконця» ловить помилку й просить власника домовитись вручну.
