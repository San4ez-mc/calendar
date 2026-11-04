import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { api } from '../api/client';
import { zonedToIso, hhmm, parseHhmm, dayTitle } from '../lib/time';

const STATUS_LABEL = { confirmed: 'Підтверджено', completed: 'Прийшов(ла)', no_show: 'Не прийшов(ла)', cancelled: 'Скасовано' };
export const STATUS_STYLE = {
  confirmed: 'bg-sky-500/20 border-sky-400 text-sky-100',
  completed: 'bg-emerald-500/20 border-emerald-400 text-emerald-100',
  no_show: 'bg-red-500/15 border-red-400 border-dashed text-red-200',
  cancelled: 'bg-slate-700/40 border-slate-500 text-slate-400 line-through',
};

/** init: { booking?, date, startMin, resourceId } — створення (без booking) або редагування. */
export default function BookingModal({ tenant, resources, services, init, canEdit, onClose, onSaved }) {
  const tz = tenant.timezone;
  const editing = !!init.booking;
  const b = init.booking;
  const [f, setF] = useState({
    clientName: b?.clientName || '', clientPhone: b?.clientPhone || '', clientTelegram: b?.clientTelegram || '', note: b?.note || '',
    serviceId: b?.serviceId || '', resourceId: b?.resourceId || init.resourceId || resources[0]?.id || '',
    date: init.date, time: hhmm(Math.max(0, init.startMin)), durationMin: b?.durationMin || services[0]?.durationMin || 60,
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const readOnly = !canEdit;

  const svcFor = useMemo(() => services.filter((s) => !s.resourceIds.length || s.resourceIds.includes(f.resourceId)), [services, f.resourceId]);

  async function run(fn) {
    setBusy(true); setErr(null);
    try { await fn(); onSaved(); } catch (e) { setErr({ message: e.message, conflict: e.status === 409 }); } finally { setBusy(false); }
  }

  const save = (force) => run(async () => {
    const start = zonedToIso(f.date, parseHhmm(f.time), tz);
    if (!editing) {
      if (!f.clientName.trim()) throw new Error('Вкажіть імʼя клієнта');
      await api.createBooking({ start, serviceId: f.serviceId || undefined, resourceId: f.resourceId, durationMin: Number(f.durationMin), clientName: f.clientName, clientPhone: f.clientPhone, clientTelegram: f.clientTelegram, note: f.note, source: 'admin', force: !!force });
    } else {
      const patch = { clientName: f.clientName, clientPhone: f.clientPhone, clientTelegram: f.clientTelegram, note: f.note };
      if (start !== b.start) patch.start = start;
      if (f.resourceId !== b.resourceId) patch.resourceId = f.resourceId;
      if (force) patch.force = true;
      await api.updateBooking(b.id, patch);
    }
  });
  const setStatus = (status) => run(async () => { if (status === 'cancelled') await api.cancelBooking(b.id); else await api.updateBooking(b.id, { status }); });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{editing ? 'Запис' : 'Новий запис'}</h2>
            <p className="text-xs text-slate-400">{dayTitle(f.date)}</p>
          </div>
          {editing && <span className={clsx('text-xs px-2 py-1 rounded-md border', STATUS_STYLE[b.status])}>{STATUS_LABEL[b.status]}</span>}
        </div>

        {editing && b.source && b.source !== 'admin' && <div className="text-xs text-slate-400">Джерело: <span className="text-slate-200">{b.source}</span>{b.clientTelegramId ? <> · Telegram id: <span className="text-slate-200">{b.clientTelegramId}</span></> : null}</div>}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="lbl">Імʼя клієнта</label><input className="inp" value={f.clientName} onChange={(e) => set('clientName', e.target.value)} disabled={readOnly} autoFocus={!editing} /></div>
          <div><label className="lbl">Телефон</label><input className="inp" value={f.clientPhone} onChange={(e) => set('clientPhone', e.target.value)} disabled={readOnly} /></div>
          <div><label className="lbl">Telegram</label><input className="inp" placeholder="@username" value={f.clientTelegram} onChange={(e) => set('clientTelegram', e.target.value)} disabled={readOnly} /></div>
          <div><label className="lbl">Співробітник</label>
            <select className="inp" value={f.resourceId} onChange={(e) => set('resourceId', e.target.value)} disabled={readOnly}>{resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </div>
          {!editing ? (
            <div><label className="lbl">Послуга</label>
              <select className="inp" value={f.serviceId} onChange={(e) => { const s = services.find((x) => x.id === e.target.value); set('serviceId', e.target.value); if (s) set('durationMin', s.durationMin); }}>
                <option value="">Без послуги</option>{svcFor.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMin} хв</option>)}
              </select>
            </div>
          ) : <div><label className="lbl">Послуга</label><div className="inp !bg-slate-900/50 text-slate-300">{b.serviceName || '—'} · {b.durationMin} хв</div></div>}
          <div><label className="lbl">Дата</label><input type="date" className="inp" value={f.date} onChange={(e) => set('date', e.target.value)} disabled={readOnly} /></div>
          <div className={editing ? '' : 'grid grid-cols-2 gap-2'}>
            <div><label className="lbl">Початок</label><input type="time" step="300" className="inp" value={f.time} onChange={(e) => set('time', e.target.value)} disabled={readOnly} /></div>
            {!editing && <div><label className="lbl">Тривалість, хв</label><input type="number" min="5" step="5" className="inp" value={f.durationMin} onChange={(e) => set('durationMin', e.target.value)} /></div>}
          </div>
          <div className="col-span-2"><label className="lbl">Нотатка</label><textarea rows={2} className="inp" value={f.note} onChange={(e) => set('note', e.target.value)} disabled={readOnly} /></div>
        </div>

        {err && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-3 py-2 text-sm text-red-200 space-y-2">
            <div>{err.message}</div>
            {err.conflict && !readOnly && <button className="btn-danger !py-1 text-xs" onClick={() => save(true)} disabled={busy}>Все одно записати (накладка)</button>}
          </div>
        )}

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button className="btn-primary" onClick={() => save(false)} disabled={busy}>{editing ? 'Зберегти' : 'Записати'}</button>
            {editing && b.status !== 'completed' && <button className="btn-ghost" onClick={() => setStatus('completed')} disabled={busy}>✓ Прийшов(ла)</button>}
            {editing && b.status !== 'no_show' && <button className="btn-ghost" onClick={() => setStatus('no_show')} disabled={busy}>✗ Не прийшов(ла)</button>}
            {editing && b.status === 'cancelled' && <button className="btn-ghost" onClick={() => setStatus('confirmed')} disabled={busy}>Відновити</button>}
            {editing && b.status !== 'cancelled' && <button className="btn-danger ml-auto" onClick={() => { if (confirm('Скасувати запис? Слот стане вільним.')) setStatus('cancelled'); }} disabled={busy}>Скасувати запис</button>}
            <button className={clsx('btn-ghost', !(editing && b.status !== 'cancelled') && 'ml-auto')} onClick={onClose}>Закрити</button>
          </div>
        )}
        {readOnly && <button className="btn-ghost" onClick={onClose}>Закрити</button>}
      </div>
    </div>
  );
}
