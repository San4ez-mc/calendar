// Публічна сторінка запису: /book/<slug>?n=Імʼя&tg=<telegramId>&u=<username>&s=<джерело>. Без входу.
// Людина обирає день, час, вводить імʼя й контакт і отримує підтвердження. Дані з посилання лише підставляються у форму.
import { useEffect, useMemo, useState } from 'react';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

function dayTitle(date) {
  const [y, m, d] = date.split('-').map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return { wd: WEEKDAYS[wd], num: d, month: MONTHS[m - 1] };
}
const timeOf = (label) => (String(label).match(/\d{1,2}:\d{2}/) || [label])[0];

async function call(path, body) {
  const res = await fetch(`/api/public${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const json = await res.json().catch(() => ({ ok: false, error: { message: 'Некоректна відповідь сервера' } }));
  if (!json.ok) { const err = new Error(json.error?.message || `HTTP ${res.status}`); err.code = json.error?.code; err.reason = json.error?.context?.reason; throw err; }
  return json;
}

export default function BookPage() {
  const slug = window.location.pathname.split('/').filter(Boolean)[1] || '';
  const q = new URLSearchParams(window.location.search);
  const [info, setInfo] = useState(null);
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState(null);
  const [name, setName] = useState(q.get('n') || '');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const tgId = /^\d{4,15}$/.test(q.get('tg') || '') ? q.get('tg') : '';
  const tgUser = (q.get('u') || '').replace(/^@/, '');
  const hasContact = !!(tgId || tgUser);

  const load = () => Promise.all([call(`/${slug}/info`), call(`/${slug}/slots?days=28`)])
    .then(([i, s]) => { setInfo(i.data); setSlots(s.data.slots); setDate((cur) => (cur && s.data.slots.some((x) => x.date === cur) ? cur : (s.data.slots[0]?.date || ''))); })
    .catch((e) => setError(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => {
    const m = new Map();
    (slots || []).forEach((s) => { if (!m.has(s.date)) m.set(s.date, []); m.get(s.date).push(s); });
    return [...m.entries()];
  }, [slots]);
  const times = days.find(([d]) => d === date)?.[1] || [];

  async function submit(e) {
    e.preventDefault();
    if (!slot) return;
    setBusy(true); setError('');
    try {
      const r = await call(`/${slug}/book`, { start: slot.start, name, phone, tgId, tgUsername: tgUser, source: q.get('s') || 'public-page' });
      setDone(r.data);
    } catch (err) {
      setError(err.reason === 'slot_taken' ? 'Цей час щойно зайняли. Оберіть інший.' : err.message);
      if (err.reason === 'slot_taken') { setSlot(null); load(); }
    } finally { setBusy(false); }
  }

  const bg = { background: "linear-gradient(rgba(2,6,23,.25), rgba(2,6,23,.55)), url('/login-bg.jpg') left center/cover no-repeat fixed, #0b1220" };
  return (
    <div className="min-h-screen flex items-start justify-center p-4 sm:p-8" style={bg}>
      <div className="w-full max-w-xl">
        <div className="text-center my-6">
          <div className="w-14 h-14 bg-brand rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-xl"><span className="text-2xl">📅</span></div>
          <h1 className="text-2xl font-bold text-white">{info ? info.service.name : 'Запис на зустріч'}</h1>
          <p className="text-slate-300 mt-1 text-sm">{info ? `${info.company} · ${info.service.durationMin} хв · час за Києвом` : 'Обери зручний час'}</p>
        </div>
        <div className="bg-slate-900/85 backdrop-blur rounded-2xl p-5 border border-white/10 shadow-2xl">
          {done ? (
            <div className="text-center py-6 space-y-3">
              <div className="text-4xl">✅</div>
              <div className="text-xl font-semibold text-white">Записано на {done.label}</div>
              <p className="text-slate-300 text-sm">Перед зустріччю тобі напише Олександр. Якщо треба змінити час, напиши йому: <a className="text-brand-light underline" href="https://t.me/olexandrmatsuk">t.me/olexandrmatsuk</a></p>
            </div>
          ) : !slots && !error ? (
            <div className="text-slate-400 text-sm text-center py-8">Завантаження…</div>
          ) : (
            <>
              {error && <div className="bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm mb-4">{error}</div>}
              {slots && slots.length === 0 && <div className="text-slate-300 text-sm text-center py-6">Найближчим часом вільних віконець нема. Напиши Олександру: <a className="text-brand-light underline" href="https://t.me/olexandrmatsuk">t.me/olexandrmatsuk</a></div>}
              {days.length > 0 && (
                <>
                  <div className="text-slate-400 text-xs uppercase tracking-wide mb-2">1. Оберіть день</div>
                  <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
                    {days.map(([d]) => {
                      const t = dayTitle(d);
                      const on = d === date;
                      return (
                        <button key={d} onClick={() => { setDate(d); setSlot(null); }} className={`shrink-0 w-16 rounded-xl py-2 text-center border transition-colors ${on ? 'bg-brand border-brand text-white' : 'bg-slate-800 border-slate-700 text-slate-200 hover:border-brand'}`}>
                          <div className="text-xs opacity-80">{t.wd}</div>
                          <div className="text-lg font-semibold leading-tight">{t.num}</div>
                          <div className="text-[10px] opacity-70">{t.month}</div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-slate-400 text-xs uppercase tracking-wide mb-2">2. Оберіть час</div>
                  <div className="grid grid-cols-4 gap-2 mb-5">
                    {times.map((s) => (
                      <button key={s.start} onClick={() => setSlot(s)} className={`rounded-lg py-2 text-sm border transition-colors ${slot?.start === s.start ? 'bg-brand border-brand text-white' : 'bg-slate-800 border-slate-700 text-slate-100 hover:border-brand'}`}>{timeOf(s.label)}</button>
                    ))}
                  </div>
                  {slot && (
                    <form onSubmit={submit} className="space-y-3">
                      <div className="text-slate-400 text-xs uppercase tracking-wide">3. Контакти</div>
                      <input className="inp" placeholder="Ваше імʼя" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
                      {hasContact
                        ? <div className="text-xs text-slate-400">Зв'яжемось у Telegram{tgUser ? `: @${tgUser}` : ''}. Можете додати телефон, якщо зручно.</div>
                        : null}
                      <input className="inp" placeholder={hasContact ? 'Телефон (необовʼязково)' : 'Телефон або @username у Telegram'} value={phone} onChange={(e) => setPhone(e.target.value)} required={!hasContact} />
                      <button disabled={busy} className="w-full bg-brand hover:bg-brand-dark disabled:opacity-60 text-white rounded-lg py-3 font-medium transition-colors">{busy ? 'Записуємо…' : `Записатись на ${slot.label}`}</button>
                    </form>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
