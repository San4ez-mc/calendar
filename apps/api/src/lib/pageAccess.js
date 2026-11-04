// Доступ до розділів за сторінками з SSO-панелі (Access.pageIds). Порожній pageIds = усі розділи; superadmin і ключ компанії — без обмежень.
// Читання довідників (співробітники, послуги, графік) відкрите завжди: без них не намалювати календар.
const RULES = [
  [(m, p) => /^\/tenant(\/|$)/.test(p), ['settings']],
  [(m, p) => /^\/(calendar|bookings|slots)(\/|$)/.test(p), ['calendar']],
  [(m, p) => m !== 'GET' && /^\/(resources|time-offs)(\/|$)/.test(p), ['resources']],
  [(m, p) => m !== 'GET' && /^\/services(\/|$)/.test(p), ['services']],
];

function requiredPages(method, path) {
  const m = String(method || 'GET').toUpperCase(); const p = String(path || '');
  for (const [test, pages] of RULES) if (test(m, p)) return pages;
  return null;
}

function isAllowed(access, method, path) {
  if (!access || access.role === 'superadmin') return true;
  const pageIds = Array.isArray(access.pageIds) ? access.pageIds : [];
  if (!pageIds.length) return true;
  const need = requiredPages(method, path);
  return !need || need.some((pg) => pageIds.includes(pg));
}

/** Чи може ця сесія бачити ключ API й налаштування компанії. */
function canSeeSettings(req) {
  if (req.authMethod === 'tenant-api-key') return true;
  return isAllowed(req.access, 'GET', '/tenant');
}

module.exports = { requiredPages, isAllowed, canSeeSettings, RULES };
