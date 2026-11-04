// Слоти, календар (день/місяць) і записи.
const express = require('express');
const core = require('@cal/core');
const { db } = require('@cal/db');
const { ValidationError } = require('@cal/errors');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
const ok = (res, data) => res.json({ ok: true, data });

// Бот/воронка (Bearer apiKey) записує в режимі «bot» — лише у вільні слоти; адмінка — «staff» (довільний час без накладок).
const modeOf = (req) => (req.authMethod === 'tenant-api-key' ? 'bot' : 'staff');

router.get('/slots', asyncHandler(async (req, res) => {
  const { serviceId, resourceId, from, to, days, limit } = req.query;
  ok(res, await core.getFreeSlots(req.tenant, { serviceId, resourceId, from, to, days, limit }));
}));

router.get('/calendar/day', asyncHandler(async (req, res) => {
  ok(res, await core.getDayView(req.tenant, String(req.query.date || core.todayIn(req.tenant.timezone)), { resourceId: req.query.resourceId || undefined }));
}));

router.get('/calendar/month', asyncHandler(async (req, res) => {
  const month = String(req.query.month || core.todayIn(req.tenant.timezone).slice(0, 7));
  ok(res, await core.getMonthView(req.tenant, month, { resourceId: req.query.resourceId || undefined }));
}));

router.get('/bookings', asyncHandler(async (req, res) => {
  const { from, to, status, resourceId, clientTelegramId, q, upcoming, limit } = req.query;
  ok(res, await core.listBookings(req.tenant, { from, to, status, resourceId, clientTelegramId, q, upcoming: upcoming === '1' || upcoming === 'true', limit }));
}));

router.post('/bookings', asyncHandler(async (req, res) => {
  const r = await core.createBooking(req.tenant, req.body || {}, { mode: modeOf(req), actor: req.actor });
  res.status(r.existing ? 200 : 201).json({ ok: true, data: r.booking, existing: r.existing });
}));

router.get('/bookings/:id', asyncHandler(async (req, res) => ok(res, core.serializeBooking(await core.getBooking(req.tenant, req.params.id), req.tenant.timezone))));

router.patch('/bookings/:id', asyncHandler(async (req, res) => {
  const b = req.body || {};
  let out = null;
  if (b.start !== undefined || b.resourceId !== undefined) {
    const cur = await core.getBooking(req.tenant, req.params.id);
    out = await core.rescheduleBooking(req.tenant, req.params.id, { start: b.start || cur.startAt.toISOString(), resourceId: b.resourceId, force: !!b.force, clientTelegramId: b.clientTelegramId }, { mode: modeOf(req) });
  }
  if (['status', 'clientName', 'clientPhone', 'clientTelegram', 'note'].some((k) => b[k] !== undefined)) out = await core.updateBookingFields(req.tenant, req.params.id, b);
  if (!out) throw new ValidationError('Нічого змінювати');
  ok(res, out);
}));

router.post('/bookings/:id/cancel', asyncHandler(async (req, res) => {
  ok(res, await core.cancelBooking(req.tenant, req.params.id, { clientTelegramId: (req.body || {}).clientTelegramId, reason: (req.body || {}).reason }));
}));

router.post('/bookings/:id/reschedule', asyncHandler(async (req, res) => {
  ok(res, await core.rescheduleBooking(req.tenant, req.params.id, req.body || {}, { mode: modeOf(req) }));
}));

// Статистика для головної: найближчі записи й лічильники.
router.get('/summary', asyncHandler(async (req, res) => {
  const now = new Date();
  const [upcoming, today] = await Promise.all([
    db.booking.count({ where: { tenantId: req.tenant.id, status: 'confirmed', startAt: { gte: now } } }),
    core.listBookings(req.tenant, { from: core.todayIn(req.tenant.timezone), to: core.todayIn(req.tenant.timezone) }),
  ]);
  ok(res, { upcoming, todayCount: today.filter((b) => b.status !== 'cancelled').length });
}));

module.exports = router;
