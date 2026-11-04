// SSO-логін адмінки + контракт SSO-панелі (GET .../projects, .../pages).
const express = require('express');
const crypto = require('node:crypto');
const { db } = require('@cal/db');
const asyncHandler = require('../middleware/asyncHandler');
const { AuthError, ForbiddenError } = require('@cal/errors');
const ssoClient = require('../lib/ssoClient');

const router = express.Router();

const SECURE_COOKIES = String(process.env.SSO_REDIRECT_URI || '').startsWith('https://');
const SESSION_COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES, maxAge: 30 * 24 * 3600 * 1000 };

// Відносний шлях цієї ж адмінки: один «/», без «//», зворотного слеша, пробілів і схеми — не відкритий редірект.
function safeNext(next) {
  return typeof next === 'string' && next.length <= 500 && next.startsWith('/') && !next.startsWith('//') && !next.includes(String.fromCharCode(92)) && !/\s/.test(next) && !next.includes('://');
}

router.get('/auth/sso/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('cal_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES, maxAge: 600_000 });
  const next = String(req.query.next || '');
  if (safeNext(next) && !next.startsWith('/login')) res.cookie('cal_login_next', next, { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES, maxAge: 600_000 });
  else res.cookie('cal_login_next', '', { maxAge: 0 });
  res.redirect(ssoClient.authorizeUrl(state));
});

router.get('/auth/callback', asyncHandler(async (req, res) => {
  const { code, state } = req.query;
  const expectedState = req.cookies?.cal_oauth_state;
  res.cookie('cal_oauth_state', '', { maxAge: 0 });
  const adminBase = (process.env.ADMIN_BASE_URL || 'http://localhost:5174').replace(/[/]$/, '');
  if (!code || !state || state !== expectedState) return void res.redirect(`${adminBase}/login?sso=state`);
  let tokenRes;
  try { tokenRes = await ssoClient.exchangeCodeForToken(String(code)); } catch { return void res.redirect(`${adminBase}/login?sso=exchange`); }
  if (!tokenRes?.access_token) return void res.redirect(`${adminBase}/login?sso=exchange`);
  res.cookie('cal_session', tokenRes.access_token, SESSION_COOKIE_OPTS);
  const next = String(req.cookies?.cal_login_next || '');
  res.cookie('cal_login_next', '', { maxAge: 0 });
  res.redirect(safeNext(next) ? adminBase + next : adminBase);
}));

router.post('/auth/logout', (req, res) => {
  res.cookie('cal_session', '', { maxAge: 0 });
  res.json({ ok: true });
});

router.get('/me', asyncHandler(async (req, res) => {
  const token = req.cookies?.cal_session;
  if (!token) throw new AuthError('Не автентифіковано');
  const identity = await ssoClient.introspect(token);
  if (!identity.active) throw new AuthError('Сесія недійсна');
  const perms = await ssoClient.getPermissions(identity.sub);
  const tenants = perms.role === 'superadmin'
    ? await db.tenant.findMany({ select: { id: true, name: true, timezone: true }, orderBy: { name: 'asc' } })
    : await db.tenant.findMany({ where: { id: { in: perms.projectIds || [] } }, select: { id: true, name: true, timezone: true }, orderBy: { name: 'asc' } });
  res.json({ ok: true, data: { user: { id: identity.sub, email: identity.email, name: identity.name }, role: perms.role, tenants, pageIds: perms.role === 'superadmin' ? [] : (Array.isArray(perms.pageIds) ? perms.pageIds : []), canEdit: perms.canEdit !== false } });
}));

// ── Контракт SSO-панелі (server-to-server, x-sso-secret) ──
function requireSsoSecret(req, res, next) {
  const secret = req.header('x-sso-secret') || '';
  if (!process.env.SSO_CLIENT_SECRET || secret !== process.env.SSO_CLIENT_SECRET) throw new ForbiddenError('invalid x-sso-secret');
  next();
}

router.get('/api/auth/sso/projects', requireSsoSecret, asyncHandler(async (req, res) => {
  const tenants = await db.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  res.json({ projects: tenants });
}));

const PAGES = [
  { id: 'calendar', label: 'Календар і записи' },
  { id: 'resources', label: 'Співробітники і графік' },
  { id: 'services', label: 'Послуги' },
  { id: 'settings', label: 'Налаштування (ключ API)' },
];

router.get('/api/auth/sso/pages', requireSsoSecret, (req, res) => res.json({ pages: PAGES }));

module.exports = router;
