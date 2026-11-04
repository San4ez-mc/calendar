// Доменна логіка календаря: її викликають і REST API (для адмінки/воронок), і MCP-інструменти.
// Усе в межах однієї компанії (tenant). Час у БД — UTC, «локальне» рахується в поясі компанії.
const { db } = require('@cal/db');
const { ValidationError, NotFoundError, ConflictError } = require('@cal/errors');
const tzlib = require('./tz');
const { computeFreeSlots, intervalConflict, OCCUPYING } = require('./slots');

const MIN = 60000;
const DAY = 24 * 60 * MIN;

function todayIn(tz, now = new Date()) { return tzlib.utcToZoned(now, tz).date; }

function parseStart(v, field = 'start') {
  const d = new Date(v);
  if (!v || Number.isNaN(d.getTime())) throw new ValidationError(`${field}: потрібна коректна дата-час (ISO)`);
  return d;
}

function serializeBooking(b, tz) {
  return {
    id: b.id,
    resourceId: b.resourceId,
    resourceName: b.resource ? b.resource.name : undefined,
    resourceColor: b.resource ? b.resource.color : undefined,
    serviceId: b.serviceId,
    serviceName: b.service ? b.service.name : undefined,
    start: b.startAt.toISOString(),
    end: b.endAt.toISOString(),
    startLabel: tzlib.slotLabel(b.startAt, tz),
    durationMin: Math.round((b.endAt - b.startAt) / MIN),
    status: b.status,
    clientName: b.clientName,
    clientPhone: b.clientPhone,
    clientTelegram: b.clientTelegram,
    clientTelegramId: b.clientTelegramId,
    source: b.source,
    note: b.note,
    createdAt: b.createdAt.toISOString(),
  };
}

const BOOKING_INCLUDE = { resource: { select: { name: true, color: true } }, service: { select: { name: true } } };

async function loadSchedule(client, tenant, fromUtc, toUtc, { includeInactiveResources = false } = {}) {
  const [resources, windows, timeOffs, bookings] = await Promise.all([
    client.resource.findMany({ where: { tenantId: tenant.id, ...(includeInactiveResources ? {} : { active: true }) }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    client.availabilityWindow.findMany({ where: { tenantId: tenant.id } }),
    client.timeOff.findMany({ where: { tenantId: tenant.id, startAt: { lt: toUtc }, endAt: { gt: fromUtc } } }),
    client.booking.findMany({ where: { tenantId: tenant.id, status: { in: [...OCCUPYING] }, startAt: { lt: toUtc }, endAt: { gt: new Date(fromUtc.getTime() - DAY) } }, include: BOOKING_INCLUDE }),
  ]);
  return { resources, windows, timeOffs, bookings };
}

async function pickService(client, tenant, serviceId) {
  if (serviceId) {
    const s = await client.service.findFirst({ where: { id: serviceId, tenantId: tenant.id }, include: { resources: true } });
    if (!s) throw new NotFoundError('Service', serviceId);
    if (!s.active) throw new ValidationError('Послуга вимкнена');
    return s;
  }
  const all = await client.service.findMany({ where: { tenantId: tenant.id, active: true }, include: { resources: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  if (all.length === 1) return all[0];
  if (!all.length) throw new ValidationError('У компанії ще немає жодної послуги');
  throw new ValidationError('Вкажіть serviceId: у компанії кілька послуг', { services: all.map((s) => ({ id: s.id, name: s.name })) });
}

const svcShape = (s) => ({ durationMin: s.durationMin, bufferMin: s.bufferMin, stepMin: s.stepMin, resourceIds: s.resources.map((r) => r.resourceId) });

/** Вільні слоти для послуги. from/to — локальні дати компанії (YYYY-MM-DD); за замовчуванням від сьогодні, days днів. */
async function getFreeSlots(tenant, { serviceId, resourceId, from, to, days, limit, now } = {}) {
  const tz = tenant.timezone;
  const nowD = now || new Date();
  const service = await pickService(db, tenant, serviceId);
  const today = todayIn(tz, nowD);
  const fromDate = from && tzlib.isDateStr(from) ? from : today;
  const horizonEnd = tzlib.addDays(today, Math.max(1, tenant.horizonDays));
  let toDate = to && tzlib.isDateStr(to) ? to : tzlib.addDays(fromDate, Math.max(1, Math.min(Number(days) || 14, 60)) - 1);
  if (toDate > horizonEnd) toDate = horizonEnd;
  if (toDate < fromDate) return { service: { id: service.id, name: service.name, durationMin: service.durationMin }, timezone: tz, slots: [] };
  const fromUtc = tzlib.zonedToUtc(fromDate, 0, tz);
  const toUtc = tzlib.zonedToUtc(tzlib.addDays(toDate, 1), 0, tz);
  const data = await loadSchedule(db, tenant, fromUtc, toUtc);
  const slots = computeFreeSlots({ tenant, service: svcShape(service), ...data, resourceId, fromDate, toDate, now: nowD, limit: limit ? Math.min(Number(limit), 500) : undefined });
  return {
    service: { id: service.id, name: service.name, durationMin: service.durationMin },
    timezone: tz,
    slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString(), label: s.label, date: s.date, resourceId: s.resourceId, resourceName: s.resourceName })),
  };
}

function subtract(intervals, cuts) {
  let cur = intervals;
  for (const [cs, ce] of cuts) {
    const next = [];
    for (const [s, e] of cur) {
      if (ce <= s || cs >= e) { next.push([s, e]); continue; }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    cur = next;
  }
  return cur;
}

/** Вікна ресурсу на локальну дату (після вирахування закриттів): [[startMs,endMs],…]. */
function windowsForDay(data, tz, day, resourceId) {
  const wd = tzlib.weekdayOf(day);
  const base = data.windows.filter((w) => w.resourceId === resourceId && w.weekday === wd).sort((a, b) => a.startMin - b.startMin)
    .map((w) => [tzlib.zonedToUtc(day, w.startMin, tz).getTime(), tzlib.zonedToUtc(day, w.endMin, tz).getTime()]);
  const cuts = data.timeOffs.filter((t) => !t.resourceId || t.resourceId === resourceId).map((t) => [t.startAt.getTime(), t.endAt.getTime()]);
  return subtract(base, cuts);
}

/** Один день: стовпчики ресурсів, вільні вікна, закриття, записи — з відступами в хвилинах від півночі. */
async function getDayView(tenant, date, { resourceId, includeCancelled } = {}) {
  const tz = tenant.timezone;
  if (!tzlib.isDateStr(date)) throw new ValidationError('date: YYYY-MM-DD');
  const [d0, d1] = tzlib.dayRangeUtc(date, tz);
  const data = await loadSchedule(db, tenant, d0, d1);
  const off = (ms) => Math.round((ms - d0.getTime()) / MIN);
  const resources = data.resources.filter((r) => !resourceId || r.id === resourceId);
  const bookings = await db.booking.findMany({
    where: { tenantId: tenant.id, startAt: { lt: d1 }, endAt: { gt: d0 }, ...(resourceId ? { resourceId } : {}), ...(includeCancelled ? {} : { status: { not: 'cancelled' } }) },
    include: BOOKING_INCLUDE, orderBy: { startAt: 'asc' },
  });
  return {
    date, timezone: tz, weekday: tzlib.weekdayOf(date),
    resources: resources.map((r) => ({ id: r.id, name: r.name, color: r.color })),
    windows: resources.flatMap((r) => windowsForDay(data, tz, date, r.id).map(([s, e]) => ({ resourceId: r.id, startMin: off(s), endMin: off(e) }))),
    timeOffs: data.timeOffs.filter((t) => !resourceId || !t.resourceId || t.resourceId === resourceId).map((t) => ({ id: t.id, resourceId: t.resourceId, startMin: off(t.startAt.getTime()), endMin: off(t.endAt.getTime()), reason: t.reason })),
    bookings: bookings.map((b) => ({ ...serializeBooking(b, tz), startMin: off(b.startAt.getTime()), endMin: off(b.endAt.getTime()) })),
  };
}

/** Місяць: по кожному дню — години вікон, зайнято, вільно, кількість записів. */
async function getMonthView(tenant, month, { resourceId } = {}) {
  const tz = tenant.timezone;
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new ValidationError('month: YYYY-MM');
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${month}-${String(daysInMonth).padStart(2, '0')}`;
  const fromUtc = tzlib.zonedToUtc(first, 0, tz);
  const toUtc = tzlib.zonedToUtc(tzlib.addDays(last, 1), 0, tz);
  const data = await loadSchedule(db, tenant, fromUtc, toUtc);
  const bookings = await db.booking.findMany({ where: { tenantId: tenant.id, status: { not: 'cancelled' }, startAt: { lt: toUtc }, endAt: { gt: fromUtc }, ...(resourceId ? { resourceId } : {}) }, select: { startAt: true, endAt: true, resourceId: true } });
  const resources = data.resources.filter((r) => !resourceId || r.id === resourceId);
  const days = [];
  for (let day = first; day <= last; day = tzlib.addDays(day, 1)) {
    const [d0, d1] = tzlib.dayRangeUtc(day, tz);
    let windowMs = 0; let bookedMs = 0;
    const dayBookings = bookings.filter((b) => b.startAt < d1 && b.endAt > d0);
    for (const r of resources) {
      const wins = windowsForDay(data, tz, day, r.id);
      for (const [s, e] of wins) windowMs += e - s;
      for (const b of dayBookings) {
        if (b.resourceId !== r.id) continue;
        for (const [s, e] of wins) { const o = Math.min(e, b.endAt.getTime()) - Math.max(s, b.startAt.getTime()); if (o > 0) bookedMs += o; }
      }
    }
    days.push({ date: day, weekday: tzlib.weekdayOf(day), windowMin: Math.round(windowMs / MIN), bookedMin: Math.round(bookedMs / MIN), freeMin: Math.max(0, Math.round((windowMs - bookedMs) / MIN)), bookings: dayBookings.length });
  }
  return { month, timezone: tz, days };
}

async function withTenantLock(tenant, fn) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenant.id}))`;
    return fn(tx);
  }, { timeout: 15000 });
}

function slotTaken() { return new ConflictError('Цей час уже зайнято або недоступний. Оберіть інший слот.', { reason: 'slot_taken' }); }

/** Запис. mode 'bot' — лише в межах вільних слотів (сітка послуги); 'staff' — довільний час без вікон, але без накладок. */
async function createBooking(tenant, input, { mode = 'bot', actor = '' } = {}) {
  const tz = tenant.timezone;
  const start = parseStart(input.start);
  const clientName = String(input.clientName || '').trim().slice(0, 200);
  const clientTelegramId = String(input.clientTelegramId || '').trim();
  const clientPhone = String(input.clientPhone || '').trim().slice(0, 50);
  if (mode === 'staff' && !clientName) throw new ValidationError('clientName обовʼязкове');
  if (mode === 'bot' && !clientName && !clientTelegramId && !clientPhone) throw new ValidationError('Потрібне імʼя, телефон або Telegram клієнта');
  const note = String(input.note || '').slice(0, 2000);

  return withTenantLock(tenant, async (tx) => {
    const service = (input.serviceId || mode === 'bot') ? await pickService(tx, tenant, input.serviceId) : null;
    const dur = service ? service.durationMin : Math.max(5, Math.min(Number(input.durationMin) || 60, 720));
    const buf = service ? service.bufferMin : 0;
    const end = new Date(start.getTime() + dur * MIN);

    if (clientTelegramId) {
      const dup = await tx.booking.findFirst({ where: { tenantId: tenant.id, clientTelegramId, startAt: start, status: 'confirmed' }, include: BOOKING_INCLUDE });
      if (dup) return { booking: serializeBooking(dup, tz), existing: true };
    }

    let resourceId = input.resourceId || '';
    const day = tzlib.utcToZoned(start, tz).date;
    const [d0, d1] = tzlib.dayRangeUtc(day, tz);
    const data = await loadSchedule(tx, tenant, d0, d1);
    if (mode === 'bot') {
      const slots = computeFreeSlots({ tenant, service: svcShape(service), ...data, resourceId: resourceId || undefined, fromDate: day, toDate: day, now: new Date() });
      const match = slots.find((s) => s.start.getTime() === start.getTime());
      if (!match) throw slotTaken();
      resourceId = match.resourceId;
    } else {
      if (!resourceId) throw new ValidationError('resourceId обовʼязковий');
      const r = await tx.resource.findFirst({ where: { id: resourceId, tenantId: tenant.id } });
      if (!r) throw new NotFoundError('Resource', resourceId);
      const conflict = intervalConflict({ resourceId, start, end, bufferMin: buf, timeOffs: data.timeOffs, bookings: data.bookings });
      if (conflict && !input.force) throw new ConflictError(`Накладка: ${conflict.reason}`, { reason: conflict.kind, bookingId: conflict.bookingId });
    }
    const created = await tx.booking.create({
      data: {
        tenantId: tenant.id, resourceId, serviceId: service ? service.id : null, startAt: start, endAt: end, bufferMin: buf, status: 'confirmed',
        clientName, clientPhone, clientTelegram: String(input.clientTelegram || '').replace(/^@/, '').slice(0, 100), clientTelegramId,
        source: String(input.source || (mode === 'bot' ? 'bot' : 'admin')).slice(0, 100), note, createdBy: actor || '',
      },
      include: BOOKING_INCLUDE,
    });
    return { booking: serializeBooking(created, tz), existing: false };
  });
}

async function getBooking(tenant, id) {
  const b = await db.booking.findFirst({ where: { id, tenantId: tenant.id }, include: BOOKING_INCLUDE });
  if (!b) throw new NotFoundError('Booking', id);
  return b;
}

async function listBookings(tenant, { from, to, status, resourceId, clientTelegramId, q, upcoming, limit } = {}) {
  const tz = tenant.timezone;
  const where = { tenantId: tenant.id };
  if (from && tzlib.isDateStr(from)) where.endAt = { gt: tzlib.zonedToUtc(from, 0, tz) };
  if (to && tzlib.isDateStr(to)) where.startAt = { lt: tzlib.zonedToUtc(tzlib.addDays(to, 1), 0, tz) };
  if (upcoming) where.endAt = { gt: new Date() };
  if (status) where.status = String(status);
  if (resourceId) where.resourceId = resourceId;
  if (clientTelegramId) where.clientTelegramId = String(clientTelegramId);
  if (q) where.OR = [{ clientName: { contains: String(q), mode: 'insensitive' } }, { clientPhone: { contains: String(q) } }, { clientTelegram: { contains: String(q), mode: 'insensitive' } }];
  const rows = await db.booking.findMany({ where, include: BOOKING_INCLUDE, orderBy: { startAt: 'asc' }, take: Math.min(Number(limit) || 200, 500) });
  return rows.map((b) => serializeBooking(b, tz));
}

/** Перенос (і/або зміна ресурсу). mode 'bot' — на вільний слот сітки послуги; 'staff' — довільний час без накладок. */
async function rescheduleBooking(tenant, id, input, { mode = 'staff' } = {}) {
  const tz = tenant.timezone;
  const start = parseStart(input.start);
  return withTenantLock(tenant, async (tx) => {
    const cur = await tx.booking.findFirst({ where: { id, tenantId: tenant.id }, include: { service: { include: { resources: true } } } });
    if (!cur) throw new NotFoundError('Booking', id);
    if (mode === 'bot' && input.clientTelegramId && String(input.clientTelegramId) !== cur.clientTelegramId) throw new NotFoundError('Booking', id);
    if (cur.status === 'cancelled') throw new ValidationError('Скасований запис не переноситься');
    const durMs = cur.endAt.getTime() - cur.startAt.getTime();
    const end = new Date(start.getTime() + durMs);
    const day = tzlib.utcToZoned(start, tz).date;
    const [d0, d1] = tzlib.dayRangeUtc(day, tz);
    const data = await loadSchedule(tx, tenant, d0, d1);
    const others = data.bookings.filter((b) => b.id !== id);
    let resourceId = input.resourceId || cur.resourceId;
    if (mode === 'bot') {
      if (!cur.service) throw new ValidationError('У запису немає послуги для підбору слота');
      const slots = computeFreeSlots({ tenant, service: svcShape(cur.service), ...data, bookings: others, resourceId: input.resourceId || undefined, fromDate: day, toDate: day, now: new Date() });
      const match = slots.find((s) => s.start.getTime() === start.getTime());
      if (!match) throw slotTaken();
      resourceId = match.resourceId;
    } else {
      const r = await tx.resource.findFirst({ where: { id: resourceId, tenantId: tenant.id } });
      if (!r) throw new NotFoundError('Resource', resourceId);
      const conflict = intervalConflict({ resourceId, start, end, bufferMin: cur.bufferMin, timeOffs: data.timeOffs, bookings: data.bookings, ignoreBookingId: id });
      if (conflict && !input.force) throw new ConflictError(`Накладка: ${conflict.reason}`, { reason: conflict.kind, bookingId: conflict.bookingId });
    }
    const upd = await tx.booking.update({ where: { id }, data: { startAt: start, endAt: end, resourceId }, include: BOOKING_INCLUDE });
    return serializeBooking(upd, tz);
  });
}

async function cancelBooking(tenant, id, { clientTelegramId, reason } = {}) {
  const cur = await db.booking.findFirst({ where: { id, tenantId: tenant.id } });
  if (!cur || (clientTelegramId && String(clientTelegramId) !== cur.clientTelegramId)) throw new NotFoundError('Booking', id);
  const upd = await db.booking.update({
    where: { id },
    data: { status: 'cancelled', cancelledAt: new Date(), note: reason ? `${cur.note ? `${cur.note}\n` : ''}Скасовано: ${String(reason).slice(0, 300)}` : cur.note },
    include: BOOKING_INCLUDE,
  });
  return serializeBooking(upd, tenant.timezone);
}

const STATUSES = new Set(['confirmed', 'cancelled', 'completed', 'no_show']);
/** Ручна правка запису адміном: статус, контакти, нотатка (час/ресурс — через rescheduleBooking). */
async function updateBookingFields(tenant, id, input) {
  const cur = await getBooking(tenant, id);
  const data = {};
  if (input.status !== undefined) {
    if (!STATUSES.has(input.status)) throw new ValidationError('status: confirmed | cancelled | completed | no_show');
    data.status = input.status;
    data.cancelledAt = input.status === 'cancelled' ? (cur.cancelledAt || new Date()) : null;
  }
  for (const k of ['clientName', 'clientPhone', 'note']) if (input[k] !== undefined) data[k] = String(input[k]).slice(0, k === 'note' ? 2000 : 200);
  if (input.clientTelegram !== undefined) data.clientTelegram = String(input.clientTelegram).replace(/^@/, '').slice(0, 100);
  const upd = await db.booking.update({ where: { id }, data, include: BOOKING_INCLUDE });
  return serializeBooking(upd, tenant.timezone);
}

/** Тижневий графік ресурсу: замінює всі вікна. Перетини в межах дня зливаються. */
async function setWindows(tenant, resourceId, windows) {
  const r = await db.resource.findFirst({ where: { id: resourceId, tenantId: tenant.id } });
  if (!r) throw new NotFoundError('Resource', resourceId);
  if (!Array.isArray(windows)) throw new ValidationError('windows: масив {weekday,startMin,endMin}');
  const byDay = new Map();
  for (const w of windows) {
    const weekday = Number(w.weekday); const startMin = Number(w.startMin); const endMin = Number(w.endMin);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new ValidationError('weekday: 1 (Пн) … 7 (Нд)');
    if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0 || endMin > 1440 || startMin >= endMin) throw new ValidationError('Вікно: 0 ≤ початок < кінець ≤ 1440 хвилин');
    if (!byDay.has(weekday)) byDay.set(weekday, []);
    byDay.get(weekday).push([startMin, endMin]);
  }
  const rows = [];
  for (const [weekday, list] of byDay) {
    list.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [s, e] of list) { const last = merged[merged.length - 1]; if (last && s <= last[1]) last[1] = Math.max(last[1], e); else merged.push([s, e]); }
    for (const [s, e] of merged) rows.push({ tenantId: tenant.id, resourceId, weekday, startMin: s, endMin: e });
  }
  await db.$transaction([db.availabilityWindow.deleteMany({ where: { tenantId: tenant.id, resourceId } }), db.availabilityWindow.createMany({ data: rows })]);
  return rows.map(({ weekday, startMin, endMin }) => ({ weekday, startMin, endMin }));
}

module.exports = {
  todayIn, serializeBooking, getFreeSlots, getDayView, getMonthView, createBooking, getBooking, listBookings,
  rescheduleBooking, cancelBooking, updateBookingFields, setWindows, BOOKING_INCLUDE, STATUSES,
};
