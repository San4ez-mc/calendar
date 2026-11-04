// Рушій вільних слотів. Чиста функція computeFreeSlots (без БД) — легко тестується; роути вантажать дані з БД.
const { zonedToUtc, weekdayOf, addDays, slotLabel } = require('./tz');

const MIN = 60000;
/** Статуси, що тримають час: скасований запис звільняє слот. */
const OCCUPYING = new Set(['confirmed', 'completed', 'no_show']);

function overlaps(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && aEnd > bStart; }

/**
 * @param {object} p
 * @param {object} p.tenant {timezone, minNoticeMin}
 * @param {object} p.service {durationMin, bufferMin, stepMin, resourceIds: string[] (порожньо = усі)}
 * @param {Array} p.resources [{id,name,color,active}]
 * @param {Array} p.windows [{resourceId, weekday, startMin, endMin}]
 * @param {Array} p.timeOffs [{resourceId|null, startAt:Date, endAt:Date}]
 * @param {Array} p.bookings [{resourceId, startAt:Date, endAt:Date, bufferMin, status}]
 * @param {string} p.fromDate 'YYYY-MM-DD' (локальна дата компанії), p.toDate включно
 * @param {Date} p.now
 */
function computeFreeSlots(p) {
  const tz = p.tenant.timezone || 'Europe/Kyiv';
  const dur = p.service.durationMin;
  const buf = p.service.bufferMin || 0;
  const step = Math.max(5, p.service.stepMin || dur + buf);
  const minStart = (p.now || new Date()).getTime() + (p.tenant.minNoticeMin || 0) * MIN;
  const allowed = p.service.resourceIds && p.service.resourceIds.length ? new Set(p.service.resourceIds) : null;
  const resources = p.resources.filter((r) => r.active !== false && (!allowed || allowed.has(r.id)) && (!p.resourceId || r.id === p.resourceId));
  const out = [];
  for (let day = p.fromDate; day <= p.toDate; day = addDays(day, 1)) {
    const wd = weekdayOf(day);
    for (const r of resources) {
      const wins = p.windows.filter((w) => w.resourceId === r.id && w.weekday === wd).sort((a, b) => a.startMin - b.startMin);
      if (!wins.length) continue;
      const offs = p.timeOffs.filter((t) => !t.resourceId || t.resourceId === r.id);
      const books = p.bookings.filter((b) => b.resourceId === r.id && OCCUPYING.has(b.status));
      for (const w of wins) {
        const wStart = zonedToUtc(day, w.startMin, tz).getTime();
        const wEnd = zonedToUtc(day, w.endMin, tz).getTime();
        for (let s = wStart; s + dur * MIN <= wEnd; s += step * MIN) {
          if (s < minStart) continue;
          const e = s + dur * MIN;
          const occEnd = e + buf * MIN;
          if (offs.some((t) => overlaps(s, e, t.startAt.getTime(), t.endAt.getTime()))) continue;
          if (books.some((b) => overlaps(s, occEnd, b.startAt.getTime(), b.endAt.getTime() + (b.bufferMin || 0) * MIN))) continue;
          out.push({ start: new Date(s), end: new Date(e), resourceId: r.id, resourceName: r.name, label: slotLabel(new Date(s), tz), date: day });
        }
      }
    }
  }
  out.sort((a, b) => a.start - b.start || a.resourceName.localeCompare(b.resourceName));
  return p.limit ? out.slice(0, p.limit) : out;
}

/** Чи вільний довільний інтервал ресурсу (для ручного запису адміном): без перевірки вікон, лише перетин із записами й закриттями. */
function intervalConflict({ resourceId, start, end, bufferMin = 0, timeOffs, bookings, ignoreBookingId }) {
  const s = start.getTime(); const e = end.getTime(); const occEnd = e + bufferMin * MIN;
  for (const t of timeOffs) {
    if ((!t.resourceId || t.resourceId === resourceId) && overlaps(s, e, t.startAt.getTime(), t.endAt.getTime())) return { kind: 'time_off', reason: t.reason || 'закрито' };
  }
  for (const b of bookings) {
    if (b.resourceId !== resourceId || !OCCUPYING.has(b.status) || b.id === ignoreBookingId) continue;
    if (overlaps(s, occEnd, b.startAt.getTime(), b.endAt.getTime() + (b.bufferMin || 0) * MIN)) return { kind: 'booking', reason: 'цей час уже зайнято', bookingId: b.id };
  }
  return null;
}

module.exports = { computeFreeSlots, intervalConflict, OCCUPYING };
