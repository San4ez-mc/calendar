const test = require('node:test');
const assert = require('node:assert/strict');
const { computeFreeSlots, intervalConflict } = require('../src/slots');
const { zonedToUtc, utcToZoned, addDays, weekdayOf, slotLabel } = require('../src/tz');

const tenant = { timezone: 'Europe/Kyiv', minNoticeMin: 0, horizonDays: 30 };
const resources = [{ id: 'r1', name: 'Олександр', active: true }];
// Пн-Пт 11:00-18:00
const windows = [1, 2, 3, 4, 5].map((weekday) => ({ resourceId: 'r1', weekday, startMin: 11 * 60, endMin: 18 * 60 }));
const service = { durationMin: 60, bufferMin: 0, stepMin: null, resourceIds: [] };
const base = { tenant, service, resources, windows, timeOffs: [], bookings: [], now: new Date('2026-11-01T00:00:00Z') };

test('tz: Київ узимку UTC+2, влітку UTC+3', () => {
  assert.equal(zonedToUtc('2026-11-10', 11 * 60, 'Europe/Kyiv').toISOString(), '2026-11-10T09:00:00.000Z');
  assert.equal(zonedToUtc('2026-07-10', 11 * 60, 'Europe/Kyiv').toISOString(), '2026-07-10T08:00:00.000Z');
});

test('tz: перехід на зимовий час 25.10.2026 не ламає вікно 11-18', () => {
  assert.equal(zonedToUtc('2026-10-25', 11 * 60, 'Europe/Kyiv').toISOString(), '2026-10-25T09:00:00.000Z');
  assert.equal(zonedToUtc('2026-10-24', 11 * 60, 'Europe/Kyiv').toISOString(), '2026-10-24T08:00:00.000Z');
});

test('tz: utcToZoned і підпис слота', () => {
  const z = utcToZoned(new Date('2026-11-10T09:00:00Z'), 'Europe/Kyiv');
  assert.deepEqual(z, { date: '2026-11-10', minutes: 660, weekday: 2 });
  assert.equal(slotLabel(new Date('2026-11-10T09:00:00Z'), 'Europe/Kyiv'), 'Вт 10.11, 11:00');
  assert.equal(weekdayOf('2026-11-08'), 7);
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
});

test('слоти: будній день 11-18 дає 7 годинних слотів, вихідні порожні', () => {
  const s = computeFreeSlots({ ...base, fromDate: '2026-11-09', toDate: '2026-11-15' }); // Пн..Нд
  assert.equal(s.length, 5 * 7);
  assert.equal(s[0].label, 'Пн 09.11, 11:00');
  assert.equal(s[6].label, 'Пн 09.11, 17:00');
  assert.ok(!s.some((x) => x.date === '2026-11-14' || x.date === '2026-11-15'));
});

test('слоти: запис забирає слот, скасований звільняє', () => {
  const b = (status) => ({ id: 'b1', resourceId: 'r1', startAt: zonedToUtc('2026-11-10', 13 * 60, tenant.timezone), endAt: zonedToUtc('2026-11-10', 14 * 60, tenant.timezone), bufferMin: 0, status });
  const taken = computeFreeSlots({ ...base, bookings: [b('confirmed')], fromDate: '2026-11-10', toDate: '2026-11-10' });
  assert.equal(taken.length, 6);
  assert.ok(!taken.some((x) => x.label.endsWith('13:00')));
  const freed = computeFreeSlots({ ...base, bookings: [b('cancelled')], fromDate: '2026-11-10', toDate: '2026-11-10' });
  assert.equal(freed.length, 7);
});

test('слоти: мінімальне попередження відсікає найближчі години', () => {
  const now = zonedToUtc('2026-11-10', 12 * 60 + 30, tenant.timezone);
  const s = computeFreeSlots({ ...base, now, tenant: { ...tenant, minNoticeMin: 120 }, fromDate: '2026-11-10', toDate: '2026-11-10' });
  assert.equal(s[0].label, 'Вт 10.11, 15:00'); // 12:30 + 2 год = 14:30, найближчий слот 15:00
});

test('слоти: закриття прибирає слоти, пауза після запису зсуває наступний', () => {
  const off = { resourceId: null, startAt: zonedToUtc('2026-11-10', 11 * 60, tenant.timezone), endAt: zonedToUtc('2026-11-10', 14 * 60, tenant.timezone), reason: 'лікар' };
  const s = computeFreeSlots({ ...base, timeOffs: [off], fromDate: '2026-11-10', toDate: '2026-11-10' });
  assert.equal(s[0].label, 'Вт 10.11, 14:00');
  const booked = { id: 'b', resourceId: 'r1', startAt: zonedToUtc('2026-11-10', 12 * 60, tenant.timezone), endAt: zonedToUtc('2026-11-10', 13 * 60, tenant.timezone), bufferMin: 30, status: 'confirmed' };
  const withBuf = computeFreeSlots({ ...base, service: { ...service, bufferMin: 30, stepMin: 30 }, bookings: [booked], fromDate: '2026-11-10', toDate: '2026-11-10' });
  const labels = withBuf.map((x) => x.label.slice(-5));
  assert.ok(!labels.includes('11:30'), 'слот 11:30 заходить на запис 12:00');
  assert.ok(!labels.includes('13:00'), 'пауза 30 хв після запису 12-13');
  assert.ok(labels.includes('13:30'));
});

test('слоти: послуга лише для певних ресурсів і фільтр по ресурсу', () => {
  const two = [...resources, { id: 'r2', name: 'Марія', active: true }];
  const w2 = [...windows, ...windows.map((w) => ({ ...w, resourceId: 'r2' }))];
  const all = computeFreeSlots({ ...base, resources: two, windows: w2, fromDate: '2026-11-10', toDate: '2026-11-10' });
  assert.equal(all.length, 14);
  const onlyR2 = computeFreeSlots({ ...base, resources: two, windows: w2, service: { ...service, resourceIds: ['r2'] }, fromDate: '2026-11-10', toDate: '2026-11-10' });
  assert.equal(onlyR2.length, 7);
  assert.ok(onlyR2.every((x) => x.resourceId === 'r2'));
  assert.equal(computeFreeSlots({ ...base, resources: two, windows: w2, resourceId: 'r1', fromDate: '2026-11-10', toDate: '2026-11-10' }).length, 7);
});

test('конфлікт інтервалу: перетин із записом і закриттям', () => {
  const bookings = [{ id: 'b1', resourceId: 'r1', startAt: new Date('2026-11-10T10:00:00Z'), endAt: new Date('2026-11-10T11:00:00Z'), bufferMin: 0, status: 'confirmed' }];
  const mk = (a, b) => ({ resourceId: 'r1', start: new Date(a), end: new Date(b), timeOffs: [], bookings });
  assert.equal(intervalConflict(mk('2026-11-10T10:30:00Z', '2026-11-10T11:30:00Z')).kind, 'booking');
  assert.equal(intervalConflict(mk('2026-11-10T11:00:00Z', '2026-11-10T12:00:00Z')), null);
  assert.equal(intervalConflict({ ...mk('2026-11-10T10:00:00Z', '2026-11-10T11:00:00Z'), ignoreBookingId: 'b1' }), null);
});
