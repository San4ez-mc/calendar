// Тонкий fetch-wrapper. tenantId підставляється автоматично з authStore.
import { useAuthStore } from '../stores/authStore';

function withTenant(path) {
  const id = useAuthStore.getState().currentTenantId;
  if (!id) return path;
  return `${path}${path.includes('?') ? '&' : '?'}tenantId=${encodeURIComponent(id)}`;
}

async function req(method, path, body, { noTenant } = {}) {
  const res = await fetch(`/api${noTenant ? path : withTenant(path)}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({ ok: false, error: { message: 'Некоректна відповідь сервера' } }));
  if (!json.ok) {
    const err = new Error(json.error?.message || `HTTP ${res.status}`);
    err.code = json.error?.code; err.context = json.error?.context; err.status = res.status;
    throw err;
  }
  return json;
}

const get = (p) => req('GET', p);
const post = (p, b) => req('POST', p, b ?? {});
const patch = (p, b) => req('PATCH', p, b);
const put = (p, b) => req('PUT', p, b);
const del = (p) => req('DELETE', p);
const qs = (o) => { const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString(); return s ? `?${s}` : ''; };

export const api = {
  tenant: () => get('/tenant'),
  patchTenant: (d) => patch('/tenant', d),
  rotateKey: () => post('/tenant/rotate-key'),
  createTenant: (d) => req('POST', '/tenants', d, { noTenant: true }),
  ssoUsers: () => get('/sso-users'),

  resources: (all) => get(`/resources${all ? '?all=1' : ''}`),
  createResource: (d) => post('/resources', d),
  updateResource: (id, d) => patch(`/resources/${id}`, d),
  deleteResource: (id) => del(`/resources/${id}`),
  windows: (id) => get(`/resources/${id}/windows`),
  setWindows: (id, windows) => put(`/resources/${id}/windows`, { windows }),

  services: (all) => get(`/services${all ? '?all=1' : ''}`),
  createService: (d) => post('/services', d),
  updateService: (id, d) => patch(`/services/${id}`, d),
  deleteService: (id) => del(`/services/${id}`),

  timeOffs: () => get('/time-offs'),
  createTimeOff: (d) => post('/time-offs', d),
  deleteTimeOff: (id) => del(`/time-offs/${id}`),

  month: (month, resourceId) => get(`/calendar/month${qs({ month, resourceId })}`),
  day: (date, resourceId) => get(`/calendar/day${qs({ date, resourceId })}`),
  bookings: (params) => get(`/bookings${qs(params || {})}`),
  createBooking: (d) => post('/bookings', d),
  updateBooking: (id, d) => patch(`/bookings/${id}`, d),
  cancelBooking: (id) => post(`/bookings/${id}/cancel`, {}),
};
