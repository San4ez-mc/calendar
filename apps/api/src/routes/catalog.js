// Довідники компанії: налаштування, співробітники (ресурси) із графіком, послуги, закриття.
const express = require('express');
const crypto = require('node:crypto');
const { db } = require('@cal/db');
const core = require('@cal/core');
const { ValidationError, NotFoundError, ConflictError, ForbiddenError } = require('@cal/errors');
const asyncHandler = require('../middleware/asyncHandler');
const ssoClient = require('../lib/ssoClient');
const { canSeeSettings } = require('../lib/pageAccess');

const router = express.Router();
const ok = (res, data) => res.json({ ok: true, data });

const newApiKey = () => `cal_${crypto.randomBytes(24).toString('hex')}`;
const isTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const int = (v, def, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def; };

function tenantShape(req) {
  const t = req.tenant;
  const out = { id: t.id, name: t.name, slug: t.slug, timezone: t.timezone, minNoticeMin: t.minNoticeMin, horizonDays: t.horizonDays };
  if (canSeeSettings(req)) out.apiKey = t.apiKey;
  return out;
}

// ── Компанія ──
router.get('/tenant', (req, res) => ok(res, tenantShape(req)));

router.patch('/tenant', asyncHandler(async (req, res) => {
  const b = req.body || {}; const data = {};
  if (b.name !== undefined) { if (!String(b.name).trim()) throw new ValidationError('name не може бути порожнім'); data.name = String(b.name).trim().slice(0, 200); }
  if (b.timezone !== undefined) { if (!isTz(b.timezone)) throw new ValidationError('Невідомий часовий пояс'); data.timezone = b.timezone; }
  if (b.minNoticeMin !== undefined) data.minNoticeMin = int(b.minNoticeMin, 120, 0, 60 * 24 * 14);
  if (b.horizonDays !== undefined) data.horizonDays = int(b.horizonDays, 30, 1, 365);
  req.tenant = await db.tenant.update({ where: { id: req.tenant.id }, data });
  ok(res, tenantShape(req));
}));

router.post('/tenant/rotate-key', asyncHandler(async (req, res) => {
  req.tenant = await db.tenant.update({ where: { id: req.tenant.id }, data: { apiKey: newApiKey() } });
  ok(res, tenantShape(req));
}));

/** Люди компанії з SSO — для прив'язки співробітника до користувача. */
router.get('/sso-users', asyncHandler(async (req, res) => ok(res, (await ssoClient.listProjectUsers(req.tenant.id)) || [])));

// ── Співробітники / ресурси ──
const resShape = (r) => ({ id: r.id, name: r.name, color: r.color, active: r.active, sortOrder: r.sortOrder, ssoUserId: r.ssoUserId });

router.get('/resources', asyncHandler(async (req, res) => {
  const rows = await db.resource.findMany({ where: { tenantId: req.tenant.id, ...(req.query.all ? {} : { active: true }) }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  ok(res, rows.map(resShape));
}));

router.post('/resources', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!String(b.name || '').trim()) throw new ValidationError('name обовʼязкове');
  const r = await db.resource.create({ data: { tenantId: req.tenant.id, name: String(b.name).trim().slice(0, 200), color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#0ea5e9', sortOrder: int(b.sortOrder, 0, -1000, 1000), ssoUserId: b.ssoUserId || null } });
  ok(res, resShape(r));
}));

async function ownResource(req) {
  const r = await db.resource.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!r) throw new NotFoundError('Resource', req.params.id);
  return r;
}

router.patch('/resources/:id', asyncHandler(async (req, res) => {
  await ownResource(req);
  const b = req.body || {}; const data = {};
  if (b.name !== undefined) { if (!String(b.name).trim()) throw new ValidationError('name не може бути порожнім'); data.name = String(b.name).trim().slice(0, 200); }
  if (b.color !== undefined && /^#[0-9a-f]{6}$/i.test(b.color)) data.color = b.color;
  if (b.active !== undefined) data.active = !!b.active;
  if (b.sortOrder !== undefined) data.sortOrder = int(b.sortOrder, 0, -1000, 1000);
  if (b.ssoUserId !== undefined) data.ssoUserId = b.ssoUserId || null;
  ok(res, resShape(await db.resource.update({ where: { id: req.params.id }, data })));
}));

router.delete('/resources/:id', asyncHandler(async (req, res) => {
  await ownResource(req);
  const used = await db.booking.count({ where: { resourceId: req.params.id } });
  if (used) throw new ConflictError('У співробітника є записи: вимкніть його замість видалення', { reason: 'has_bookings', bookings: used });
  await db.resource.delete({ where: { id: req.params.id } });
  ok(res, { deleted: true });
}));

router.get('/resources/:id/windows', asyncHandler(async (req, res) => {
  await ownResource(req);
  const rows = await db.availabilityWindow.findMany({ where: { tenantId: req.tenant.id, resourceId: req.params.id }, orderBy: [{ weekday: 'asc' }, { startMin: 'asc' }] });
  ok(res, rows.map(({ weekday, startMin, endMin }) => ({ weekday, startMin, endMin })));
}));

router.put('/resources/:id/windows', asyncHandler(async (req, res) => {
  await ownResource(req);
  ok(res, await core.setWindows(req.tenant, req.params.id, (req.body || {}).windows));
}));

// ── Послуги ──
const svcShape = (s) => ({ id: s.id, name: s.name, durationMin: s.durationMin, bufferMin: s.bufferMin, stepMin: s.stepMin, price: s.price, active: s.active, sortOrder: s.sortOrder, resourceIds: (s.resources || []).map((x) => x.resourceId) });

async function checkResourceIds(req, ids) {
  if (!Array.isArray(ids)) return [];
  const own = await db.resource.findMany({ where: { tenantId: req.tenant.id, id: { in: ids } }, select: { id: true } });
  if (own.length !== new Set(ids).size) throw new ValidationError('resourceIds: є невідомі співробітники');
  return own.map((r) => r.id);
}

router.get('/services', asyncHandler(async (req, res) => {
  const rows = await db.service.findMany({ where: { tenantId: req.tenant.id, ...(req.query.all ? {} : { active: true }) }, include: { resources: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  ok(res, rows.map(svcShape));
}));

function serviceData(b, partial) {
  const d = {};
  if (b.name !== undefined || !partial) { if (!String(b.name || '').trim()) throw new ValidationError('name обовʼязкове'); d.name = String(b.name).trim().slice(0, 200); }
  if (b.durationMin !== undefined || !partial) d.durationMin = int(b.durationMin, 60, 5, 720);
  if (b.bufferMin !== undefined) d.bufferMin = int(b.bufferMin, 0, 0, 240);
  if (b.stepMin !== undefined) d.stepMin = b.stepMin === null || b.stepMin === '' ? null : int(b.stepMin, 30, 5, 720);
  if (b.price !== undefined) d.price = b.price === null || b.price === '' ? null : int(b.price, 0, 0, 10_000_000);
  if (b.active !== undefined) d.active = !!b.active;
  if (b.sortOrder !== undefined) d.sortOrder = int(b.sortOrder, 0, -1000, 1000);
  return d;
}

router.post('/services', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const ids = await checkResourceIds(req, b.resourceIds);
  const s = await db.service.create({ data: { tenantId: req.tenant.id, ...serviceData(b, false), resources: { create: ids.map((resourceId) => ({ resourceId })) } }, include: { resources: true } });
  ok(res, svcShape(s));
}));

router.patch('/services/:id', asyncHandler(async (req, res) => {
  const cur = await db.service.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!cur) throw new NotFoundError('Service', req.params.id);
  const b = req.body || {};
  const data = serviceData(b, true);
  if (b.resourceIds !== undefined) {
    const ids = await checkResourceIds(req, b.resourceIds);
    await db.serviceResource.deleteMany({ where: { serviceId: cur.id } });
    if (ids.length) await db.serviceResource.createMany({ data: ids.map((resourceId) => ({ serviceId: cur.id, resourceId })) });
  }
  ok(res, svcShape(await db.service.update({ where: { id: cur.id }, data, include: { resources: true } })));
}));

router.delete('/services/:id', asyncHandler(async (req, res) => {
  const cur = await db.service.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!cur) throw new NotFoundError('Service', req.params.id);
  await db.service.delete({ where: { id: cur.id } });
  ok(res, { deleted: true });
}));

// ── Закриття (відпустка, перерва, вихідний) ──
const offShape = (t) => ({ id: t.id, resourceId: t.resourceId, start: t.startAt.toISOString(), end: t.endAt.toISOString(), reason: t.reason });

router.get('/time-offs', asyncHandler(async (req, res) => {
  const where = { tenantId: req.tenant.id };
  if (req.query.from) where.endAt = { gt: new Date(`${req.query.from}T00:00:00Z`) };
  else where.endAt = { gt: new Date() };
  ok(res, (await db.timeOff.findMany({ where, orderBy: { startAt: 'asc' }, take: 300 })).map(offShape));
}));

router.post('/time-offs', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const startAt = new Date(b.start); const endAt = new Date(b.end);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) throw new ValidationError('start/end: коректний інтервал (ISO), кінець пізніше початку');
  if (b.resourceId) await ownResource({ params: { id: b.resourceId }, tenant: req.tenant });
  const t = await db.timeOff.create({ data: { tenantId: req.tenant.id, resourceId: b.resourceId || null, startAt, endAt, reason: String(b.reason || '').slice(0, 300) } });
  ok(res, offShape(t));
}));

router.delete('/time-offs/:id', asyncHandler(async (req, res) => {
  const cur = await db.timeOff.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!cur) throw new NotFoundError('TimeOff', req.params.id);
  await db.timeOff.delete({ where: { id: cur.id } });
  ok(res, { deleted: true });
}));

module.exports = router;
module.exports.newApiKey = newApiKey;
module.exports.isTz = isTz;
module.exports.ForbiddenError = ForbiddenError;
