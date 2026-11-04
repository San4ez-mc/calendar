import { useAuthStore } from '../stores/authStore';

export default function NoAccess() {
  const { user, logout } = useAuthStore();
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card p-8 max-w-md text-center">
        <div className="text-4xl mb-3">🔒</div>
        <h1 className="text-xl font-semibold mb-2">Немає доступу до жодної компанії</h1>
        <p className="text-slate-400 text-sm mb-5">Ви увійшли як {user?.email}. Попросіть адміністратора видати доступ до Календаря в панелі доступів SSO.</p>
        <button className="btn-ghost" onClick={logout}>Вийти</button>
      </div>
    </div>
  );
}
