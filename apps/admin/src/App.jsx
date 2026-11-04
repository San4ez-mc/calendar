import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import Layout from './components/Layout';
import Login from './pages/Login';
import NoAccess from './pages/NoAccess';
import CalendarPage from './pages/CalendarPage';
import TeamPage from './pages/TeamPage';
import ServicesPage from './pages/ServicesPage';
import SettingsPage from './pages/SettingsPage';

function ProtectedShell({ children }) {
  const { isLoading, isAuthenticated, tenants } = useAuthStore();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">Завантаження…</div>;
  if (!isAuthenticated) return <Login />;
  if (tenants.length === 0) return <NoAccess />;
  return children;
}

export default function App() {
  const fetchMe = useAuthStore((s) => s.fetchMe);
  useEffect(() => { fetchMe(); }, [fetchMe]);
  return (
    <BrowserRouter>
      <ProtectedShell>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<CalendarPage />} />
            <Route path="/team" element={<TeamPage />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </ProtectedShell>
    </BrowserRouter>
  );
}
