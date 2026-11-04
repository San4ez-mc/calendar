# Fineko Calendar — правила роботи над проєктом

> Окремий мікросервіс запису (календар для експертів, салонів тощо): `calendar.fineko.space`, порт 4800, БД `fineko_calendar`.

## 1. Що це
Мультитенантний календар: **Tenant** (компанія) → **Resource** (співробітник/майстер/експерт) → **Service** (послуга, тривалість) → **AvailabilityWindow** («вільні віконця» на тиждень) / **TimeOff** (закриття) / **Booking** (запис клієнта). Багато користувачів SSO на одну компанію; салон = багато ресурсів і послуг.
Свідомо поза межами першої версії: оплата, двостороння синхронізація з Google Calendar, автоматичні Meet/Zoom, нагадування клієнтам (потрібен воркер), перенос/скасування клієнтом у боті (API готовий: `calendar_reschedule_booking`, `calendar_cancel_booking`).

## 2. Правила
1. Усі зміни через Git: локально → commit → push → на сервері `bash deploy.sh`. Файли на сервері не редагувати.
2. Час у БД — UTC; «локальне» (графік, слоти) — у поясі компанії `Tenant.timezone`. Усі обчислення слотів — лише в `packages/core` (`tz.js`, `slots.js`, `ops.js`), REST і MCP викликають ті самі функції.
3. Накладки неможливі: створення/перенос запису йде під `pg_advisory_xact_lock` на компанію (тест гонки в `scripts/smoke.js` + ручний). Скасований запис слот звільняє.
4. Авторизація: адмінка — SSO-сесія (`cal_session`), права з `/oauth/permissions` (роль + `projectIds` = id компаній + `pageIds`); воронки/боти/MCP — `Authorization: Bearer <Tenant.apiKey>` (одна компанія). Бот записує в режимі `bot` (лише у вільні слоти сітки), адмін — `staff` (довільний час без накладок, `force` для свідомої накладки).
5. Нова сутність → 4 місця: `schema.prisma`, REST-роут, MCP-інструмент (`apps/mcp/src/tools.js`), сторінка адмінки.
6. Відповідь API: `{ ok:true, data }` або `{ ok:false, error:{code,message,context?} }`. Конфлікт слота: HTTP 409, `error.context.reason = 'slot_taken'`.
7. Схема БД: `prisma db push` без `--accept-data-loss` (як у CRM/SSO). Блокові коментарі в schema.prisma заборонені (лише `//`, `///`).

## 3. Тести
- `npm test` — юніт-тести рушія слотів і часових поясів (9, у т.ч. перехід на зимовий час).
- `CAL_URL=… CAL_KEY=… node scripts/smoke.js` — наскрізна перевірка API (слоти, запис, накладка, ідемпотентність, день/місяць, перенос, скасування, ізоляція ключів, MCP). Локально `SKIP_MCP_HTTP=1` (на цій машині шлях `/api/mcp` перехоплює локальний мережевий шар; на сервері працює).

## 4. Інтеграції
- **SSO:** продукт `calendar` (реєстр `PRODUCTS` в SSO), каталог проєктів/сторінок `GET /api/auth/sso/projects|pages` (`x-sso-secret`).
- **Flows:** воронки `sell-ai-seller`, `bot-karta-sales` — вузли «Календар: …», ключі воронки `CALENDAR_URL/API_KEY/SERVICE_ID/SOURCE` (патч `platform/scripts/patch-calendar-booking-2026-11-04.js`).
- Деплой першого запуску: `DEPLOY.md`.
