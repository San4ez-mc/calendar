// Публічна сторінка запису для клієнтів: без входу й без ключів. Компанія — за slug у посиланні (/book/<slug>).
// Віддаємо лише вільні віконця й приймаємо один запис; чужих записів, імен і контактів тут не видно.
const express = require('express');
const core = require('@cal/core');
const { db } = require('@cal/db');
const { NotFoundError, ValidationError } = require('@cal/errors');
const asyncHandler = require('../middleware/asyncHandler');
const notify = require('../lib/notify');

const router = express.Router();

// Проста межа від спаму: на IP — 120 читань і 8 записів за 10 хвилин (памʼять процесу, одного сервера досить).
const hits = new Map();
function limit(kind, max) {
  return (req, res, next) => {
    const k = `${kind}:${req.ip}`;
    const now = Date.now();
    const rec = (hits.get(k) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (rec.length >= max) return res.status(429).json({ ok: false, error: { code: 'RATE_LIMIT', message: 'Забагато спроб. Спробуйте за кілька хвилин.' } });
    rec.push(now); hits.set(k, rec);
    next();
  };
}
setInterval(() => { const cut = Date.now() - 10 * 60 * 1000; for (const [k, v] of hits) { if (!v.some((t) => t > cut)) hits.delete(k); } }, 5 * 60 * 1000).unref();

const tenantBySlug = asyncHandler(async (req, res, next) => {
  const tenant = await db.tenant.findUnique({ where: { slug: String(req.params.slug || '').toLowerCase() } });
  if (!tenant) throw new NotFoundError('Tenant', req.params.slug);
  req.tenant = tenant;
  next();
});

async function pickService(tenant, serviceId) {
  const where = { tenantId: tenant.id, active: true, ...(serviceId ? { id: String(serviceId) } : {}) };
  const s = await db.service.findFirst({ where, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  if (!s) throw new NotFoundError('Service', serviceId || '');
  return s;
}

router.get('/:slug/info', limit('r', 120), tenantBySlug, asyncHandler(async (req, res) => {
  const s = await pickService(req.tenant, req.query.serviceId);
  res.json({ ok: true, data: { company: req.tenant.name, timezone: req.tenant.timezone, service: { id: s.id, name: s.name, durationMin: s.durationMin } } });
}));

router.get('/:slug/slots', limit('r', 120), tenantBySlug, asyncHandler(async (req, res) => {
  const s = await pickService(req.tenant, req.query.serviceId);
  const days = Math.min(Math.max(Number(req.query.days) || 21, 1), 45);
  const r = await core.getFreeSlots(req.tenant, { serviceId: s.id, days, limit: 400 });
  res.json({ ok: true, data: { timezone: req.tenant.timezone, slots: (r.slots || []).map((x) => ({ start: x.start, date: x.date, label: x.label })) } });
}));

router.post('/:slug/book', limit('w', 8), tenantBySlug, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (name.length < 2) throw new ValidationError('Вкажіть імʼя');
  const phone = String(b.phone || '').trim();
  const tgId = String(b.tgId || '').trim();
  const tgUser = String(b.tgUsername || '').replace(/^@/, '').trim();
  if (!phone && !tgId && !tgUser) throw new ValidationError('Вкажіть телефон або Telegram, щоб ми могли з вами звʼязатись');
  if (tgId && !/^\d{4,15}$/.test(tgId)) throw new ValidationError('Некоректний Telegram id');
  const s = await pickService(req.tenant, b.serviceId);
  const source = String(b.source || 'public-page').slice(0, 80);
  const note = String(b.note || '').slice(0, 1000);
  const r = await core.createBooking(req.tenant, {
    start: b.start, serviceId: s.id, clientName: name, clientPhone: phone, clientTelegram: tgUser, clientTelegramId: tgId, source, note,
  }, { mode: 'bot', actor: 'public' });
  if (!r.existing) notify.bookingCreated(req.tenant, r.booking, { source, note }).catch(() => {});
  res.status(r.existing ? 200 : 201).json({ ok: true, existing: r.existing, data: { id: r.booking.id, start: r.booking.start, label: r.booking.startLabel, durationMin: r.booking.durationMin } });
}));

module.exports = router;
