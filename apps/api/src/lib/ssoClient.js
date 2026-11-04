// Клієнт до FINEKO SSO (контракт той самий, що в CRM/flows):
//   GET  {SSO}/authorize?client_id&redirect_uri&state   → логін → код
//   POST {SSO}/oauth/token       {code,client_id,client_secret} → {access_token,user}
//   POST {SSO}/oauth/introspect  {token}                          → {active,sub,email,name}
//   POST {SSO}/oauth/permissions {client_id,client_secret,userId,product} → {role,projectIds,pageIds,canEdit}
//   POST {SSO}/oauth/product-users {client_id,client_secret,product,projectId} → {users:[{id,name}]}
const logger = require('@cal/logger');

const SSO_URL = process.env.SSO_URL || 'http://localhost:4600';
const CLIENT_ID = process.env.SSO_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SSO_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.SSO_REDIRECT_URI || '';
const PRODUCT = 'calendar';

function authorizeUrl(state) {
  const params = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state: state || '' });
  return `${SSO_URL}/authorize?${params}`;
}

async function exchangeCodeForToken(code) {
  const res = await fetch(`${SSO_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`SSO /oauth/token HTTP ${res.status}`);
  return res.json();
}

async function introspect(token) {
  const res = await fetch(`${SSO_URL}/oauth/introspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res || !res.ok) return { active: false };
  return res.json();
}

const permCache = new Map();
const PERM_TTL_MS = 30_000;

async function getPermissions(userId) {
  const cached = permCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const res = await fetch(`${SSO_URL}/oauth/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, userId, product: PRODUCT }),
    signal: AbortSignal.timeout(8000),
  }).catch((err) => { logger.warn('SSO /oauth/permissions unreachable', { message: err.message }); return null; });
  const value = res && res.ok ? await res.json() : { role: 'none', projectIds: [], pageIds: [], canEdit: true };
  permCache.set(userId, { value, expiresAt: Date.now() + PERM_TTL_MS });
  return value;
}

/** Люди компанії з доступом до календаря (для прив'язки співробітника до користувача SSO). null — SSO недоступний. */
const usersCache = new Map();
async function listProjectUsers(projectId) {
  const cached = usersCache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const res = await fetch(`${SSO_URL}/oauth/product-users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, product: PRODUCT, projectId }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const j = await res.json().catch(() => null);
  const value = j && Array.isArray(j.users) ? j.users.map((u) => ({ id: u.id, name: u.name })) : null;
  if (value) usersCache.set(projectId, { value, expiresAt: Date.now() + 60_000 });
  return value;
}

module.exports = { authorizeUrl, exchangeCodeForToken, introspect, getPermissions, listProjectUsers, SSO_URL, PRODUCT };
