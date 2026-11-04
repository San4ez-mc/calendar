// Стан автентифікації + вибрана компанія. SSO-сесія живе в httpOnly cookie на боці API (cal_session).
import { create } from 'zustand';

const KEY = 'cal_tenant_id';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, v); } catch { /* приватний режим */ } };

export const useAuthStore = create((set, get) => ({
  isLoading: true,
  isAuthenticated: false,
  user: null,
  role: 'none',
  pageIds: [],
  canEdit: true,
  tenants: [],
  currentTenantId: read(),

  setTenant(id) { write(id); set({ currentTenantId: id }); },

  async fetchMe() {
    set({ isLoading: true });
    try {
      const res = await fetch('/me', { credentials: 'include' });
      if (!res.ok) throw new Error('unauthenticated');
      const json = await res.json();
      const tenants = json.data.tenants || [];
      const saved = get().currentTenantId;
      const currentTenantId = tenants.some((t) => t.id === saved) ? saved : (tenants[0]?.id || null);
      if (currentTenantId) write(currentTenantId);
      set({ isAuthenticated: true, user: json.data.user, role: json.data.role, pageIds: json.data.pageIds || [], canEdit: json.data.canEdit !== false, tenants, currentTenantId, isLoading: false });
    } catch {
      set({ isAuthenticated: false, user: null, tenants: [], isLoading: false });
    }
  },

  async logout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    set({ isAuthenticated: false, user: null, tenants: [] });
  },

  /** Чи показувати розділ: порожній pageIds = усі; superadmin = усі. */
  can(pageId) {
    const { role, pageIds } = get();
    return role === 'superadmin' || !pageIds.length || pageIds.includes(pageId);
  },
  currentTenant() { const { tenants, currentTenantId } = get(); return tenants.find((t) => t.id === currentTenantId) || null; },
}));
