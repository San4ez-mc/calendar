import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../stores/authStore';

const TZS = ['Europe/Kyiv', 'Europe/Warsaw', 'Europe/Berlin', 'Europe/London', 'Europe/Prague', 'Europe/Vilnius', 'Asia/Tbilisi', 'Asia/Dubai', 'America/New_York', 'UTC'];

export default function SettingsPage() {
  const { role, canEdit, fetchMe, setTenant } = useAuthStore();
  const [t, setT] = useState(null);
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [newCo, setNewCo] = useState({ name: '', timezone: 'Europe/Kyiv' });
  const [created, setCreated] = useState(null);

  useEffect(() => { api.tenant().then((r) => setT(r.data)).catch((e) => setError(e.message)); }, []);
  if (!t) return <div className="text-slate-500 text-sm">{error || 'Завантаження…'}</div>;

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };
  async function save() {
    try { const r = await api.patchTenant({ name: t.name, timezone: t.timezone, minNoticeMin: Number(t.minNoticeMin), horizonDays: Number(t.horizonDays) }); setT(r.data); setError(''); flash('Збережено ✓'); fetchMe(); } catch (e) { setError(e.message); }
  }
  async function rotate() {
    if (!confirm('Створити новий ключ? Старий перестане працювати: воронки, які його використовують, треба оновити.')) return;
    try { const r = await api.rotateKey(); setT(r.data); setShow(true); } catch (e) { setError(e.message); }
  }
  async function createCompany() {
    try { const r = await api.createTenant(newCo); setCreated(r.data); setNewCo({ name: '', timezone: 'Europe/Kyiv' }); await fetchMe(); } catch (e) { setError(e.message); }
  }
  const origin = window.location.origin;
  const key = t.apiKey || '';
  const masked = key ? `${key.slice(0, 8)}${'•'.repeat(24)}` : 'недоступно для вашого рівня доступу';

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-lg font-semibold">Налаштування компанії</h1>
      {error && <div className="bg-red-900/30 border border-red-800 rounded-lg px-3 py-2 text-sm text-red-200">{error}</div>}

      <div className="card p-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><label className="lbl">Назва компанії</label><input className="inp" value={t.name} disabled={!canEdit} onChange={(e) => setT({ ...t, name: e.target.value })} /></div>
          <div><label className="lbl">Часовий пояс (усі години в календарі за ним)</label>
            <input className="inp" list="tzs" value={t.timezone} disabled={!canEdit} onChange={(e) => setT({ ...t, timezone: e.target.value })} /><datalist id="tzs">{TZS.map((z) => <option key={z} value={z} />)}</datalist>
          </div>
          <div><label className="lbl">Не пропонувати слоти ближче ніж, хв</label><input type="number" min="0" step="15" className="inp" value={t.minNoticeMin} disabled={!canEdit} onChange={(e) => setT({ ...t, minNoticeMin: e.target.value })} /></div>
          <div><label className="lbl">Запис уперед не більше ніж, днів</label><input type="number" min="1" max="365" className="inp" value={t.horizonDays} disabled={!canEdit} onChange={(e) => setT({ ...t, horizonDays: e.target.value })} /></div>
        </div>
        {canEdit && <div className="flex items-center gap-3"><button className="btn-primary" onClick={save}>Зберегти</button>{msg && <span className="text-sm text-emerald-400">{msg}</span>}</div>}
      </div>

      <div className="card p-4 space-y-3">
        <div>
          <h2 className="font-medium">Підключення воронок і ботів</h2>
          <p className="text-xs text-slate-400">Ключ дає воронці повний доступ до календаря цієї компанії (слоти, записи, скасування). Зберігайте його лише у ключах воронки.</p>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs break-all">{key ? (show ? key : masked) : masked}</code>
          {key && <><button className="btn-ghost" onClick={() => setShow(!show)}>{show ? 'Сховати' : 'Показати'}</button><button className="btn-ghost" onClick={() => { navigator.clipboard?.writeText(key); flash('Скопійовано ✓'); }}>Копіювати</button></>}
          {key && canEdit && <button className="btn-danger" onClick={rotate}>Новий ключ</button>}
        </div>
        <div className="text-xs text-slate-400 space-y-1.5 pt-1">
          <div>API: <code className="text-slate-200">{origin}/api</code> · заголовок <code className="text-slate-200">Authorization: Bearer ключ</code></div>
          <div>Вільні слоти: <code className="text-slate-200">GET /api/slots?days=14</code> · запис: <code className="text-slate-200">POST /api/bookings</code> {'{start, clientName, clientTelegramId}'}</div>
          <div>MCP (JSON-RPC): <code className="text-slate-200">POST {origin}/api/mcp</code> з тим самим ключем: інструменти <code className="text-slate-200">calendar_get_free_slots</code>, <code className="text-slate-200">calendar_create_booking</code>, <code className="text-slate-200">calendar_find_bookings</code> та інші.</div>
        </div>
      </div>

      {role === 'superadmin' && (
        <div className="card p-4 space-y-3">
          <div><h2 className="font-medium">Нова компанія</h2><p className="text-xs text-slate-400">Салон чи експерт зі своїм календарем, ключем і співробітниками. Доступ людям видається в панелі SSO (продукт «Календар»).</p></div>
          <div className="grid sm:grid-cols-3 gap-2 items-end">
            <div className="sm:col-span-2"><label className="lbl">Назва</label><input className="inp" value={newCo.name} onChange={(e) => setNewCo({ ...newCo, name: e.target.value })} placeholder="Салон «Лілія»" /></div>
            <button className="btn-primary" onClick={createCompany} disabled={!newCo.name.trim()}>Створити</button>
          </div>
          {created && (
            <div className="bg-emerald-900/20 border border-emerald-800 rounded-lg p-3 text-sm space-y-1">
              <div>Створено «{created.name}». Ключ API (покажу лише зараз):</div>
              <code className="block bg-slate-950 rounded px-2 py-1 text-xs break-all">{created.apiKey}</code>
              <button className="btn-ghost !py-1 text-xs mt-1" onClick={() => { setTenant(created.id); window.location.reload(); }}>Перейти до цієї компанії</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
