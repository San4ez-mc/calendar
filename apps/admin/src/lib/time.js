// Час у поясі компанії (без залежностей). «Локальна» дата/хвилини ↔ ISO (UTC).
const cache = new Map();
function fmt(tz) {
  let f = cache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); cache.set(tz, f); }
  return f;
}
function offsetMin(ms, tz) {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60000);
}

/** ('2026-11-10', 660, tz) → ISO UTC */
export function zonedToIso(date, minutes, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  const first = naive - offsetMin(naive, tz) * 60000;
  return new Date(naive - offsetMin(first, tz) * 60000).toISOString();
}

/** ISO → { date, minutes } у поясі tz */
export function isoToZoned(iso, tz) {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(iso)).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export const todayIn = (tz) => isoToZoned(new Date().toISOString(), tz).date;
export const nowMinutesIn = (tz) => isoToZoned(new Date().toISOString(), tz).minutes;

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function weekdayOf(date) { // 1=Пн … 7=Нд
  const [y, m, d] = date.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
export const WEEKDAYS_FULL = ['Понеділок', 'Вівторок', 'Середа', 'Четвер', 'Пʼятниця', 'Субота', 'Неділя'];
const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
const MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
export const monthTitle = (month) => { const [y, m] = month.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
export const dayTitle = (date) => { const [y, m, d] = date.split('-').map(Number); return `${WEEKDAYS_FULL[weekdayOf(date) - 1]}, ${d} ${MONTHS_GEN[m - 1]} ${y}`; };

export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const parseHhmm = (s) => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export function hours(min) {
  if (!min) return '0';
  const h = Math.floor(min / 60); const m = min % 60;
  return m ? `${h}г ${m}хв` : `${h}г`;
}
