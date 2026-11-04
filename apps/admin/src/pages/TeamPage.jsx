import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { api } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { WEEKDAYS_FULL, hhmm, parseHhmm, zonedToIso, isoToZoned } from '../lib/time';

const COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316'];

export default function TeamPage() {
  const tenant = useAuthStore((s) => s.currentTenant());
  const canEdit = useAuthStore((s) => s.canEdit);
  const [resources, setResources] = useState([]);
  const [ssoUsers, setSsoUsers] = useState([]);
  const [timeOffs, setTimeOffs] = useState([]);
  const [open, setOpen] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [r, t, u] = await Promise.all([api.resources(true), api.timeOffs(), api.ssoUsers().catch(() => ({ data: [] }))]);
      setResources(r.data); setTimeOffs(t.data); setSsoUsers(u.data || []);
      setOpen((o) => o || r.data[0]?.id || null);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const guard = async (fn) => { setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } };
  const add = () => name.trim() && guard(async () => { const r = await api.createResource({ name, color: COLORS[resources.length % COLORS.length] }); setName(''); setOpen(r.data.id); });

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold">Співробітники і графік</h1>
        <p className="text-sm text-slate-400">Кожен співробітник (експерт, майстер, кабінет) має власні «вільні віконечка» на тиждень. Саме в них клієнти й боти можуть записуватись.</p>
      </div>
      {error && <div className="bg-red-900/30 border border-red-800 rounded-lg px-3 py-2 text-sm text-red-200">{error}</div>}

      {canEdit && (
        <div className="card p-3 flex gap-2">
          <input className="inp" placeholder="Імʼя нового співробітника" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn-primary whitespace-nowrap" onClick={add} disabled={!name.trim()}>＋ Додати</button>
        </div>
      )}

      {resources.map((r) => (
        <div key={r.id} className={clsx('card', !r.active && 'opacity-60')}>
          <div className="p-3 flex flex-wrap items-center gap-3 cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>
            <i className="w-3 h-3 rounded-full" style={{ background: r.color }} />
            <span className="font-medium">{r.name}</span>
            {!r.active && <span className="text-xs text-slate-400 border border-slate-700 rounded px-1.5">вимкнено</span>}
            <span className="ml-auto text-slate-500 text-sm">{open === r.id ? '▲' : '▼'}</span>
          </div>
          {open === r.id && (
            <div className="border-t border-slate-800 p-4 space-y-5">
              <div className="grid sm:grid-cols-3 gap-3">
                <div><label className="lbl">Імʼя</label><input className="inp" defaultValue={r.name} disabled={!canEdit} onBlur={(e) => e.target.value.trim() && e.target.value !== r.name && guard(() => api.updateResource(r.id, { name: e.target.value }))} /></div>
                <div><label className="lbl">Колір</label>
                  <div className="flex gap-1.5 flex-wrap">{COLORS.map((c) => <button key={c} disabled={!canEdit} onClick={() => guard(() => api.updateResource(r.id, { color: c }))} className={clsx('w-6 h-6 rounded-full border-2', r.color === c ? 'border-white' : 'border-transparent')} style={{ background: c }} aria-label={c} />)}</div>
                </div>
                <div><label className="lbl">Привʼязка до користувача SSO</label>
                  <select className="inp" value={r.ssoUserId || ''} disabled={!canEdit} onChange={(e) => guard(() => api.updateResource(r.id, { ssoUserId: e.target.value || null }))}>
                    <option value="">— не привʼязано —</option>{ssoUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>

              <ScheduleEditor resource={r} canEdit={canEdit} onError={setError} />

              {canEdit && (
                <div className="flex gap-2 pt-1 border-t border-slate-800">
                  <button className="btn-ghost mt-3" onClick={() => guard(() => api.updateResource(r.id, { active: !r.active }))}>{r.active ? 'Вимкнути' : 'Увімкнути'}</button>
                  <button className="btn-danger mt-3" onClick={() => confirm(`Видалити «${r.name}»? Якщо є записи, видалення заблоковано: тоді вимкніть.`) && guard(() => api.deleteResource(r.id))}>Видалити</button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <TimeOffs tz={tenant?.timezone || 'Europe/Kyiv'} resources={resources} timeOffs={timeOffs} canEdit={canEdit} onChange={load} onError={setError} />
    </div>
  );
}

function ScheduleEditor({ resource, canEdit, onError }) {
  const [days, setDays] = useState(null); // weekday(1..7) → [{s:'11:00', e:'18:00'}]
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const w = (await api.windows(resource.id)).data;
        const m = {}; for (let d = 1; d <= 7; d++) m[d] = [];
        w.forEach((x) => m[x.weekday].push({ s: hhmm(x.startMin), e: hhmm(x.endMin) }));
        setDays(m);
      } catch (e) { onError(e.message); }
    })();
  }, [resource.id, onError]);
  if (!days) return <div className="text-sm text-slate-500">Завантаження графіка…</div>;

  const upd = (d, i, k, v) => { setSaved(false); setDays((x) => ({ ...x, [d]: x[d].map((r, j) => (j === i ? { ...r, [k]: v } : r)) })); };
  const addRange = (d) => { setSaved(false); setDays((x) => ({ ...x, [d]: [...x[d], { s: '11:00', e: '18:00' }] })); };
  const rmRange = (d, i) => { setSaved(false); setDays((x) => ({ ...x, [d]: x[d].filter((_, j) => j !== i) })); };
  const preset = (from, to) => { setSaved(false); setDays((x) => { const n = { ...x }; for (let d = 1; d <= 5; d++) n[d] = [{ s: from, e: to }]; n[6] = []; n[7] = []; return n; }); };
  const copyFromMon = () => { setSaved(false); setDays((x) => { const n = { ...x }; for (let d = 2; d <= 5; d++) n[d] = x[1].map((r) => ({ ...r })); return n; }); };

  async function save() {
    try {
      const windows = [];
      for (let d = 1; d <= 7; d++) for (const r of days[d]) {
        const s = parseHhmm(r.s); const e = parseHhmm(r.e);
        if (e <= s) throw new Error(`${WEEKDAYS_FULL[d - 1]}: кінець має бути пізніше початку`);
        windows.push({ weekday: d, startMin: s, endMin: e });
      }
      await api.setWindows(resource.id, windows);
      setSaved(true); onError('');
    } catch (e) { onError(e.message); }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h3 className="text-sm font-medium">Тижневий графік: вільні віконечка для запису</h3>
        {canEdit && <div className="ml-auto flex gap-1.5 flex-wrap">
          <button className="btn-ghost !py-1 text-xs" onClick={() => preset('09:00', '18:00')}>Пн–Пт 9–18</button>
          <button className="btn-ghost !py-1 text-xs" onClick={() => preset('11:00', '18:00')}>Пн–Пт 11–18</button>
          <button className="btn-ghost !py-1 text-xs" onClick={copyFromMon}>Пн → Вт–Пт</button>
        </div>}
      </div>
      <div className="space-y-1.5">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <div key={d} className="flex items-start gap-3 py-1.5 border-b border-slate-800/60">
            <div className={clsx('w-28 shrink-0 text-sm pt-2', d > 5 ? 'text-slate-500' : 'text-slate-300')}>{WEEKDAYS_FULL[d - 1]}</div>
            <div className="flex-1 space-y-1.5">
              {days[d].length === 0 && <div className="text-sm text-slate-600 pt-2">вихідний</div>}
              {days[d].map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="time" className="inp !w-28" value={r.s} disabled={!canEdit} onChange={(e) => upd(d, i, 's', e.target.value)} />
                  <span className="text-slate-500">–</span>
                  <input type="time" className="inp !w-28" value={r.e} disabled={!canEdit} onChange={(e) => upd(d, i, 'e', e.target.value)} />
                  {canEdit && <button className="text-slate-500 hover:text-red-400 px-1" onClick={() => rmRange(d, i)} aria-label="Прибрати">✕</button>}
                </div>
              ))}
            </div>
            {canEdit && <button className="btn-ghost !py-1 text-xs mt-1" onClick={() => addRange(d)}>＋ вікно</button>}
          </div>
        ))}
      </div>
      {canEdit && <div className="flex items-center gap-3 mt-3"><button className="btn-primary" onClick={save}>Зберегти графік</button>{saved && <span className="text-sm text-emerald-400">Збережено ✓</span>}</div>}
    </div>
  );
}

function TimeOffs({ tz, resources, timeOffs, canEdit, onChange, onError }) {
  const [f, setF] = useState({ resourceId: '', start: '', end: '', reason: '' });
  const toIso = (v) => { const [d, t] = v.split('T'); return zonedToIso(d, parseHhmm(t), tz); };
  const nameOf = (id) => (id ? resources.find((r) => r.id === id)?.name || '—' : 'Уся компанія');
  const fmt = (iso) => { const z = isoToZoned(iso, tz); return `${z.date.slice(8)}.${z.date.slice(5, 7)}.${z.date.slice(0, 4)} ${hhmm(z.minutes)}`; };

  async function add() {
    try {
      if (!f.start || !f.end) throw new Error('Вкажіть початок і кінець');
      await api.createTimeOff({ resourceId: f.resourceId || undefined, start: toIso(f.start), end: toIso(f.end), reason: f.reason });
      setF({ resourceId: '', start: '', end: '', reason: '' }); onError(''); onChange();
    } catch (e) { onError(e.message); }
  }

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h2 className="font-medium">Закриті години: відпустки, перерви, вихідні</h2>
        <p className="text-xs text-slate-400">У цей час записів немає, навіть якщо за графіком він вільний.</p>
      </div>
      {canEdit && (
        <div className="grid sm:grid-cols-5 gap-2 items-end">
          <div><label className="lbl">Кого</label><select className="inp" value={f.resourceId} onChange={(e) => setF({ ...f, resourceId: e.target.value })}><option value="">Уся компанія</option>{resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
          <div><label className="lbl">Початок</label><input type="datetime-local" className="inp" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
          <div><label className="lbl">Кінець</label><input type="datetime-local" className="inp" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
          <div><label className="lbl">Причина</label><input className="inp" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="відпустка" /></div>
          <button className="btn-primary" onClick={add}>Додати</button>
        </div>
      )}
      {timeOffs.length === 0 ? <div className="text-sm text-slate-500">Немає запланованих закриттів.</div> : (
        <ul className="divide-y divide-slate-800">
          {timeOffs.map((t) => (
            <li key={t.id} className="py-2 flex items-center gap-3 text-sm">
              <span className="font-medium w-36 truncate">{nameOf(t.resourceId)}</span>
              <span className="text-slate-300">{fmt(t.start)} → {fmt(t.end)}</span>
              <span className="text-slate-500 truncate">{t.reason}</span>
              {canEdit && <button className="ml-auto text-slate-500 hover:text-red-400" onClick={async () => { try { await api.deleteTimeOff(t.id); onChange(); } catch (e) { onError(e.message); } }}>✕</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
