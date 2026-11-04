// Створення нових компаній — лише superadmin (SSO-сесія). Повертає apiKey, який вставляють у воронку.
const express = require('express');
const { db } = require('@cal/db');
const { AuthError, ForbiddenError, ValidationError } = require('@cal/errors');
const asyncHandler = require('../middleware/asyncHandler');
const ssoClient = require('../lib/ssoClient');
const { newApiKey, isTz } = require('./catalog');

const router = express.Router();

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9а-яіїєґ]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'company';

router.post('/tenants', asyncHandler(async (req, res) => {
  const token = req.cookies?.cal_session;
  if (!token) throw new AuthError('Не автентифіковано');
  const identity = await ssoClient.introspect(token);
  if (!identity.active) throw new AuthError('Сесія недійсна');
  const perms = await ssoClient.getPermissions(identity.sub);
  if (perms.role !== 'superadmin') throw new ForbiddenError('Лише суперадмін створює компанії');
  const b = req.body || {};
  if (!String(b.name || '').trim()) throw new ValidationError('name обовʼязкове');
  if (b.timezone && !isTz(b.timezone)) throw new ValidationError('Невідомий часовий пояс');
  let slug = slugify(b.slug || b.name);
  if (await db.tenant.findUnique({ where: { slug } })) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const t = await db.tenant.create({ data: { name: String(b.name).trim().slice(0, 200), slug, apiKey: newApiKey(), timezone: b.timezone || 'Europe/Kyiv' } });
  res.status(201).json({ ok: true, data: { id: t.id, name: t.name, slug: t.slug, timezone: t.timezone, apiKey: t.apiKey } });
}));

module.exports = router;
