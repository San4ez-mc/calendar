import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { useAuthStore } from '../stores/authStore';

const NAV = [
  { to: '/', label: 'Календар', icon: '📅', page: 'calendar', end: true },
  { to: '/team', label: 'Співробітники', icon: '👥', page: 'resources' },
  { to: '/services', label: 'Послуги', icon: '💼', page: 'services' },
  { to: '/settings', label: 'Налаштування', icon: '⚙️', page: 'settings' },
];

export default function Layout() {
  const { user, tenants, currentTenantId, setTenant, logout, can, role } = useAuthStore();
  const items = NAV.filter((n) => can(n.page));
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1500px] mx-auto px-4 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2 font-semibold"><span className="text-xl">📅</span><span className="hidden sm:inline">Fineko Календар</span></div>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {items.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => clsx('px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors', isActive ? 'bg-brand/15 text-brand-light' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800')}>
                <span className="mr-1">{n.icon}</span>{n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {tenants.length > 1 || role === 'superadmin' ? (
              <select className="inp !w-auto max-w-[200px]" value={currentTenantId || ''} onChange={(e) => { setTenant(e.target.value); window.location.reload(); }}>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ) : <span className="text-sm text-slate-400 hidden md:inline">{tenants[0]?.name}</span>}
            <span className="text-xs text-slate-500 hidden lg:inline">{user?.email}</span>
            <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={logout}>Вийти</button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-[1500px] w-full mx-auto px-4 py-5"><Outlet /></main>
    </div>
  );
}
