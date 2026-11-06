// Fineko Calendar API — Express, CommonJS, той самий стиль, що CRM.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const { db } = require('@cal/db');
const logger = require('@cal/logger');

const errorHandler = require('./middleware/errorHandler');
const asyncHandler = require('./middleware/asyncHandler');
const { resolveTenant } = require('./middleware/resolveTenant');

const authSsoRouter = require('./routes/auth-sso');
const mcpRouter = require('./routes/mcp');
const tenantsAdminRouter = require('./routes/tenants-admin');
const catalogRouter = require('./routes/catalog');
const scheduleRouter = require('./routes/schedule');
const publicRouter = require('./routes/public');

const app = express();
const PORT = Number(process.env.PORT || 4800);
app.set('trust proxy', 1);

// Усе, крім сторінки запису, не можна вбудовувати в чужі сторінки (frame-ancestors 'none').
// Публічну сторінку /book/* можна вбудувати в iframe лише на *.fineko.space і доменах з CAL_EMBED_ORIGINS (через кому, напр. https://my-site.com).
const baseCsp = { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"] };
const embedOrigins = ["'self'", 'https://*.fineko.space', ...String(process.env.CAL_EMBED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean)];
const helmetDefault = helmet({ contentSecurityPolicy: { directives: { ...baseCsp, frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: false });
const helmetEmbeddable = helmet({ contentSecurityPolicy: { directives: { ...baseCsp, frameAncestors: embedOrigins } }, frameguard: false, crossOriginResourcePolicy: false });
app.use((req, res, next) => (req.method === 'GET' && (req.path === '/book' || req.path.startsWith('/book/')) ? helmetEmbeddable : helmetDefault)(req, res, next));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
// Воронки звертаються server-to-server (без cookie); адмінка — той самий origin. Cookie-запити з чужих origin відхиляємо.
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)), credentials: true }));

app.get('/health', asyncHandler(async (req, res) => {
  const tenants = await db.tenant.count().catch(() => -1);
  res.json({ ok: true, service: 'fineko-calendar-api', tenants });
}));

app.use(authSsoRouter);
app.use('/api/public', publicRouter);
app.use('/api', mcpRouter);
app.use('/api', tenantsAdminRouter);
app.use('/api', resolveTenant, catalogRouter, scheduleRouter);

// Продакшн: зібрана адмінка (npm run build:admin → public/admin) роздається цим же процесом.
const ADMIN_DIST = path.join(__dirname, '../../../public/admin');
app.use(express.static(ADMIN_DIST));
app.get('*', (req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path === '/me' || req.path === '/health') return next();
  res.sendFile(path.join(ADMIN_DIST, 'index.html'), (err) => { if (err) next(); });
});

app.use((req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: `No route ${req.method} ${req.path}` } }));
app.use(errorHandler);

app.listen(PORT, () => logger.info(`Fineko Calendar API listening on :${PORT}`));
