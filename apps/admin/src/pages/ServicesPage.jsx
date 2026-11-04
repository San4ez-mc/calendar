import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { api } from '../api/client';
import { useAuthStore } from '../stores/authStore';

const EMPTY = { name: '', durationMin: 60, bufferMin: 0, stepMin: '', price: '', active: true, resourceIds: [] };

export default function ServicesPage() {
  const canEdit = useAuthStore((s) => s.canEdit);
  const [services, setServices] = useState([]);
  const [resources, setResources] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { const [s, r] = await Promise.all([api.services(true), api.resources()]); setServices(s.data); setResources(r.data); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    try {
      const body = { name: form.name, durationMin: Number(form.durationMin), bufferMin: Number(form.bufferMin) || 0, stepMin: form.stepMin === '' ? null : Number(form.stepMin), price: form.price === '' ? null : Number(form.price), active: form.active, resourceIds: form.resourceIds };
      if (form.id) await api.updateService(form.id, body); else await api.createService(body);
      setForm(null); setError(''); load();
    } catch (e) { setError(e.message); }
  }
  const toggleRes = (id) => setForm((f) => ({ ...f, resourceIds: f.resourceIds.includes(id) ? f.resourceIds.filter((x) => x !== id) : [...f.resourceIds, id] }));

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Послуги</h1>
          <p className="text-sm text-slate-400">Тривалість визначає розмір «віконця». Якщо до послуги не вибрано співробітників, її виконують усі.</p>
        </div>
        {canEdit && <button className="btn-primary ml-auto" onClick={() => setForm({ ...EMPTY })}>＋ Послуга</button>}
      </div>
      {error && <div className="bg-red-900/30 border border-red-800 rounded-lg px-3 py-2 text-sm text-red-200">{error}</div>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-slate-400 text-xs"><tr><th className="text-left px-4 py-2">Назва</th><th className="text-left px-3 py-2">Тривалість</th><th className="text-left px-3 py-2">Пауза</th><th className="text-left px-3 py-2">Ціна</th><th className="text-left px-3 py-2">Виконують</th><th /></tr></thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} className={clsx('border-t border-slate-800', !s.active && 'opacity-50')}>
                <td className="px-4 py-2.5 font-medium">{s.name}{!s.active && <span className="ml-2 text-xs text-slate-500">вимкнено</span>}</td>
                <td className="px-3 py-2.5">{s.durationMin} хв</td>
                <td className="px-3 py-2.5">{s.bufferMin ? `${s.bufferMin} хв` : '—'}</td>
                <td className="px-3 py-2.5">{s.price != null ? `${s.price} грн` : '—'}</td>
                <td className="px-3 py-2.5 text-slate-400">{s.resourceIds.length ? s.resourceIds.map((id) => resources.find((r) => r.id === id)?.name).filter(Boolean).join(', ') : 'усі'}</td>
                <td className="px-3 py-2.5 text-right">{canEdit && <button className="btn-ghost !py-1 text-xs" onClick={() => setForm({ ...s, stepMin: s.stepMin ?? '', price: s.price ?? '' })}>Змінити</button>}</td>
              </tr>
            ))}
            {!services.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Послуг ще немає.</td></tr>}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setForm(null)}>
          <div className="card w-full max-w-lg p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">{form.id ? 'Послуга' : 'Нова послуга'}</h2>
            <div><label className="lbl">Назва</label><input className="inp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="lbl">Тривалість, хв</label><input type="number" min="5" step="5" className="inp" value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })} /></div>
              <div><label className="lbl">Пауза після, хв</label><input type="number" min="0" step="5" className="inp" value={form.bufferMin} onChange={(e) => setForm({ ...form, bufferMin: e.target.value })} /></div>
              <div><label className="lbl">Крок слотів, хв</label><input type="number" min="5" step="5" className="inp" placeholder="авто" value={form.stepMin} onChange={(e) => setForm({ ...form, stepMin: e.target.value })} /></div>
            </div>
            <div><label className="lbl">Ціна, грн (необовʼязково)</label><input type="number" min="0" className="inp" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
            <div>
              <label className="lbl">Хто виконує (порожньо = усі)</label>
              <div className="flex flex-wrap gap-2">{resources.map((r) => (
                <button key={r.id} onClick={() => toggleRes(r.id)} className={clsx('px-3 py-1.5 rounded-lg text-sm border', form.resourceIds.includes(r.id) ? 'border-brand bg-brand/15 text-brand-light' : 'border-slate-700 text-slate-400')}>{r.name}</button>
              ))}</div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Активна (доступна для запису)</label>
            <p className="text-xs text-slate-500">Крок слотів: «авто» = тривалість + пауза, тобто віконця йдуть одне за одним. Менший крок дає більше варіантів часу.</p>
            <div className="flex gap-2 pt-1">
              <button className="btn-primary" onClick={save} disabled={!form.name.trim()}>Зберегти</button>
              {form.id && <button className="btn-danger" onClick={async () => { if (confirm('Видалити послугу? Наявні записи лишаться без послуги.')) { try { await api.deleteService(form.id); setForm(null); load(); } catch (e) { setError(e.message); } } }}>Видалити</button>}
              <button className="btn-ghost ml-auto" onClick={() => setForm(null)}>Скасувати</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
