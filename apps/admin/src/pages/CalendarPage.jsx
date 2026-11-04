import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { api } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import BookingModal, { STATUS_STYLE } from '../components/BookingModal';
import { todayIn, nowMinutesIn, addDays, addMonths, weekdayOf, WEEKDAYS, monthTitle, dayTitle, hhmm, hours } from '../lib/time';

const PX_PER_MIN = 1; // 60px на годину
const readView = () => { try { return localStorage.getItem('cal_view') || 'month'; } catch { return 'month'; } };

export default function CalendarPage() {
  const tenant = useAuthStore((s) => s.currentTenant());
  const { user, role, canEdit } = useAuthStore();
  const tz = tenant?.timezone || 'Europe/Kyiv';
  const today = todayIn(tz);

  const [view, setView] = useState(readView());
  const [date, setDate] = useState(today);
  const [resourceId, setResourceId] = useState('');
  const [resources, setResources] = useState([]);
  const [services, setServices] = useState([]);
  const [monthData, setMonthData] = useState(null);
  const [dayData, setDayData] = useState(null);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const [nowMin, setNowMin] = useState(nowMinutesIn(tz));
  const month = date.slice(0, 7);

  useEffect(() => { try { localStorage.setItem('cal_view', view); } catch { /* ignore */ } }, [view]);

  useEffect(() => {
    (async () => {
      try {
        const [r, s] = await Promise.all([api.resources(), api.services()]);
        setResources(r.data); setServices(s.data);
        // Майстер без прав суперадміна бачить спершу свій стовпчик (якщо його привʼязано до користувача SSO).
        const mine = r.data.find((x) => x.ssoUserId && x.ssoUserId === user?.id);
        if (mine && role !== 'superadmin') setResourceId(mine.id);
      } catch (e) { setError(e.message); }
    })();
  }, [user?.id, role]);

  const load = useCallback(async () => {
    setError('');
    try {
      if (view === 'month') setMonthData((await api.month(month, resourceId)).data);
      else setDayData((await api.day(date, resourceId)).data);
    } catch (e) { setError(e.message); }
  }, [view, month, date, resourceId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNowMin(nowMinutesIn(tz)), 60000); return () => clearInterval(t); }, [tz]);

  const shift = (n) => (view === 'month' ? setDate(`${addMonths(month, n)}-01`) : setDate(addDays(date, n)));
  const afterSave = () => { setModal(null); load(); };
  const openCreate = (d, startMin, rid) => canEdit && setModal({ date: d, startMin, resourceId: rid || resourceId || resources[0]?.id });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button className="btn-ghost !px-3" onClick={() => shift(-1)} aria-label="Назад">‹</button>
          <button className="btn-ghost" onClick={() => setDate(today)}>Сьогодні</button>
          <button className="btn-ghost !px-3" onClick={() => shift(1)} aria-label="Вперед">›</button>
        </div>
        <h1 className="text-lg font-semibold ml-1">{view === 'month' ? monthTitle(month) : dayTitle(date)}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className="inp !w-auto" value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
            <option value="">Усі співробітники</option>
            {resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div className="flex rounded-lg overflow-hidden border border-slate-700">
            {[['month', 'Місяць'], ['day', 'День']].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)} className={clsx('px-3.5 py-2 text-sm transition-colors', view === k ? 'bg-brand text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-800')}>{l}</button>
            ))}
          </div>
          {canEdit && <button className="btn-primary" onClick={() => openCreate(view === 'day' ? date : (date < today ? today : date), 11 * 60)} disabled={!resources.length}>＋ Запис</button>}
        </div>
      </div>

      {error && <div className="bg-red-900/30 border border-red-800 rounded-lg px-3 py-2 text-sm text-red-200">{error}</div>}
      {!resources.length && !error && <div className="card p-6 text-center text-slate-400 text-sm">Спершу додайте співробітника й графік на сторінці «Співробітники».</div>}

      {view === 'month' && monthData && <MonthGrid data={monthData} today={today} onPick={(d) => { setDate(d); setView('day'); }} />}
      {view === 'day' && dayData && <DayGrid data={dayData} today={today} nowMin={nowMin} canEdit={canEdit} onCreate={openCreate} onOpen={(bk) => setModal({ booking: bk, date, startMin: bk.startMin, resourceId: bk.resourceId })} />}

      <Legend />
      {modal && <BookingModal tenant={tenant} resources={resources} services={services} init={modal} canEdit={canEdit} onClose={() => setModal(null)} onSaved={afterSave} />}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-slate-400">
      <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-emerald-500/30 border border-emerald-500/60" /> вільні віконечка для запису</span>
      <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-sky-500/40 border border-sky-400" /> записи клієнтів</span>
      <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm" style={{ background: 'repeating-linear-gradient(45deg,#334155,#334155 3px,#1e293b 3px,#1e293b 6px)' }} /> закрито (відпустка, перерва)</span>
    </div>
  );
}

function MonthGrid({ data, today, onPick }) {
  const first = data.days[0];
  const lead = weekdayOf(first.date) - 1;
  const cells = [...Array(lead).fill(null), ...data.days];
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-slate-800 bg-slate-900/60">
        {WEEKDAYS.map((w, i) => <div key={w} className={clsx('px-2 py-2 text-xs font-medium text-center', i > 4 ? 'text-slate-500' : 'text-slate-400')}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} className="min-h-[92px] border-b border-r border-slate-800/60 bg-slate-950/40" />;
          const off = d.windowMin === 0;
          const pct = d.windowMin ? Math.min(100, Math.round((d.bookedMin / d.windowMin) * 100)) : 0;
          return (
            <button key={d.date} onClick={() => onPick(d.date)} className={clsx('min-h-[92px] p-2 text-left border-b border-r border-slate-800/60 hover:bg-slate-800/60 transition-colors flex flex-col gap-1', off && 'bg-slate-950/40')}>
              <div className="flex items-center justify-between">
                <span className={clsx('text-sm w-6 h-6 flex items-center justify-center rounded-full', d.date === today ? 'bg-brand text-white font-semibold' : off ? 'text-slate-600' : 'text-slate-200')}>{Number(d.date.slice(8))}</span>
                {d.bookings > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-sky-500/20 text-sky-200 border border-sky-500/40">{d.bookings} {d.bookings === 1 ? 'запис' : 'записи'}</span>}
              </div>
              {!off ? (
                <>
                  <div className={clsx('text-[11px]', d.freeMin > 0 ? 'text-emerald-300' : 'text-red-300')}>{d.freeMin > 0 ? `вільно ${hours(d.freeMin)}` : 'усе зайнято'}</div>
                  <div className="h-1 rounded bg-emerald-500/25 overflow-hidden mt-auto"><div className="h-full bg-sky-400" style={{ width: `${pct}%` }} /></div>
                </>
              ) : <div className="text-[11px] text-slate-600">{d.bookings ? '' : 'без вікон'}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayGrid({ data, today, nowMin, canEdit, onCreate, onOpen }) {
  const bounds = useMemo(() => {
    const all = [...data.windows.map((w) => [w.startMin, w.endMin]), ...data.bookings.map((b) => [b.startMin, b.endMin])];
    const lo = Math.min(8 * 60, ...all.map((x) => x[0]));
    const hi = Math.max(20 * 60, ...all.map((x) => x[1]));
    return { start: Math.max(0, Math.floor(lo / 60) * 60), end: Math.min(1440, Math.ceil(hi / 60) * 60) };
  }, [data]);
  const height = (bounds.end - bounds.start) * PX_PER_MIN;
  const hourMarks = []; for (let m = bounds.start; m < bounds.end; m += 60) hourMarks.push(m);
  const scroller = useRef(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = Math.max(0, (Math.min(...data.windows.map((w) => w.startMin), 9 * 60) - bounds.start - 30) * PX_PER_MIN); }, [data, bounds.start]);

  if (!data.resources.length) return <div className="card p-6 text-slate-400 text-sm">Немає співробітників.</div>;
  const isToday = data.date === today;

  function clickColumn(e, rid) {
    if (!canEdit) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const min = bounds.start + Math.round((e.clientY - rect.top) / PX_PER_MIN / 15) * 15;
    onCreate(data.date, Math.min(min, 1440 - 15), rid);
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex border-b border-slate-800 bg-slate-900/60">
        <div className="w-14 shrink-0" />
        {data.resources.map((r) => (
          <div key={r.id} className="flex-1 min-w-[180px] px-3 py-2 text-sm font-medium flex items-center gap-2 border-l border-slate-800">
            <i className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />{r.name}
            <span className="text-xs text-slate-500 font-normal ml-auto">{data.bookings.filter((b) => b.resourceId === r.id && b.status !== 'cancelled').length} зап.</span>
          </div>
        ))}
      </div>
      <div ref={scroller} className="overflow-auto max-h-[70vh]">
        <div className="flex" style={{ height }}>
          <div className="w-14 shrink-0 relative">
            {hourMarks.map((m) => <div key={m} className="absolute right-2 text-[11px] text-slate-500 -translate-y-1/2" style={{ top: (m - bounds.start) * PX_PER_MIN }}>{hhmm(m)}</div>)}
          </div>
          {data.resources.map((r) => (
            <div key={r.id} className={clsx('flex-1 min-w-[180px] relative border-l border-slate-800', canEdit && 'cursor-cell')} onClick={(e) => clickColumn(e, r.id)}>
              {hourMarks.map((m) => <div key={m} className="absolute inset-x-0 border-t border-slate-800/80" style={{ top: (m - bounds.start) * PX_PER_MIN }} />)}
              {data.windows.filter((w) => w.resourceId === r.id).map((w, i) => (
                <div key={`w${i}`} className="absolute inset-x-0 bg-emerald-500/10 border-l-2 border-emerald-500/60 pointer-events-none" style={{ top: (w.startMin - bounds.start) * PX_PER_MIN, height: (w.endMin - w.startMin) * PX_PER_MIN }}>
                  <span className="text-[10px] text-emerald-400/70 px-1.5">вільні віконечка {hhmm(w.startMin)}–{hhmm(w.endMin)}</span>
                </div>
              ))}
              {data.timeOffs.filter((t) => !t.resourceId || t.resourceId === r.id).map((t) => {
                const s = Math.max(t.startMin, bounds.start); const e = Math.min(t.endMin, bounds.end);
                if (e <= s) return null;
                return <div key={t.id} title={t.reason || 'закрито'} className="absolute inset-x-0 pointer-events-none" style={{ top: (s - bounds.start) * PX_PER_MIN, height: (e - s) * PX_PER_MIN, background: 'repeating-linear-gradient(45deg,rgba(51,65,85,.7),rgba(51,65,85,.7) 4px,rgba(30,41,59,.7) 4px,rgba(30,41,59,.7) 8px)' }}><span className="text-[10px] text-slate-300 px-1.5">{t.reason || 'закрито'}</span></div>;
              })}
              {data.bookings.filter((b) => b.resourceId === r.id).map((b) => (
                <button key={b.id} onClick={(e) => { e.stopPropagation(); onOpen(b); }} className={clsx('absolute left-1 right-1 rounded-md border-l-4 px-2 py-1 text-left overflow-hidden text-xs hover:brightness-125 transition', STATUS_STYLE[b.status])} style={{ top: (b.startMin - bounds.start) * PX_PER_MIN + 1, height: Math.max(22, (b.endMin - b.startMin) * PX_PER_MIN - 2), borderLeftColor: r.color }}>
                  <div className="font-medium truncate">{hhmm(b.startMin)} {b.clientName || 'Без імені'}</div>
                  <div className="truncate opacity-80">{b.serviceName || ''}{b.source && b.source !== 'admin' ? ` · ${b.source}` : ''}</div>
                </button>
              ))}
              {isToday && nowMin >= bounds.start && nowMin <= bounds.end && <div className="absolute inset-x-0 border-t-2 border-red-500 pointer-events-none z-10" style={{ top: (nowMin - bounds.start) * PX_PER_MIN }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
