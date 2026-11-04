// Робота з часовими поясами без зовнішніх залежностей (Intl). Усе «локальне» — в поясі компанії, у БД — UTC.
const dtfCache = new Map();
function dtf(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dtfCache.set(tz, f);
  }
  return f;
}

/** Зсув пояса від UTC у хвилинах у момент utcMs. */
function offsetMin(utcMs, tz) {
  const parts = Object.fromEntries(dtf(tz).formatToParts(new Date(utcMs)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** «2026-11-10» + хвилини від півночі в поясі tz → Date (UTC). */
function zonedToUtc(dateStr, minutes, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  const first = naive - offsetMin(naive, tz) * 60000;
  return new Date(naive - offsetMin(first, tz) * 60000);
}

/** Date (UTC) → { date:'YYYY-MM-DD', minutes, weekday(1=Пн..7=Нд) } в поясі tz. */
function utcToZoned(date, tz) {
  const parts = Object.fromEntries(dtf(tz).formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  return { date: dateStr, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: weekdayOf(dateStr) };
}

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Нд
  return w === 0 ? 7 : w;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

function isDateStr(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)); }

/** [початок доби, початок наступної доби) у UTC для локальної дати. */
function dayRangeUtc(dateStr, tz) {
  return [zonedToUtc(dateStr, 0, tz), zonedToUtc(addDays(dateStr, 1), 0, tz)];
}

const DAYS_SHORT = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
/** «Пн 10.11, 11:00» — підпис слота для людини. */
function slotLabel(date, tz) {
  const z = utcToZoned(date, tz);
  const [, m, d] = z.date.split('-');
  const hh = String(Math.floor(z.minutes / 60)).padStart(2, '0');
  const mm = String(z.minutes % 60).padStart(2, '0');
  return `${DAYS_SHORT[z.weekday % 7]} ${d}.${m}, ${hh}:${mm}`;
}

module.exports = { zonedToUtc, utcToZoned, weekdayOf, addDays, isDateStr, dayRangeUtc, slotLabel, offsetMin };
