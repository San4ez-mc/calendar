// Єдина точка авторизації бізнес-роутів. Два шляхи:
//   1) Authorization: Bearer <tenant.apiKey>  — воронка / бот / MCP, повний доступ у межах своєї компанії.
//   2) cal_session cookie (SSO access_token)  — веб-адмінка; компанія береться з ?tenantId=, права з SSO /oauth/permissions.
const { db } = require('@cal/db');
const { AuthError, ForbiddenError, NotFoundError } = require('@cal/errors');
const asyncHandler = require('./asyncHandler');
const ssoClient = require('../lib/ssoClient');
const { isAllowed } = require('../lib/pageAccess');

function bearer(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.header('authorization') || '');
  return match ? match[1].trim() : '';
}

const resolveTenant = asyncHandler(async (req, res, next) => {
  const apiKey = bearer(req);
  if (apiKey) {
    const tenant = await db.tenant.findUnique({ where: { apiKey } });
    if (!tenant) throw new AuthError('Invalid tenant apiKey');
    req.tenant = tenant;
    req.authMethod = 'tenant-api-key';
    req.access = { role: 'superadmin', canEdit: true };
    req.actor = 'bot';
    return next();
  }

  const token = req.cookies?.cal_session;
  if (!token) throw new AuthError('Не автентифіковано — увійдіть через SSO');
  const identity = await ssoClient.introspect(token);
  if (!identity.active) throw new AuthError('Сесія недійсна або протерміновано');
  req.user = { id: identity.sub, email: identity.email, name: identity.name };

  const tenantId = req.params.tenantId || req.query.tenantId;
  if (!tenantId) throw new ForbiddenError('tenantId обовʼязковий (query)');

  const perms = await ssoClient.getPermissions(identity.sub);
  const allowed = perms.role === 'superadmin' || (perms.role === 'user' && perms.projectIds.includes(tenantId));
  if (!allowed) throw new ForbiddenError('Немає доступу до цієї компанії');

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant', tenantId);

  req.tenant = tenant;
  req.authMethod = 'sso-session';
  req.actor = `user:${identity.sub}`;
  req.access = { role: perms.role, canEdit: perms.canEdit !== false, pageIds: Array.isArray(perms.pageIds) ? perms.pageIds : [] };
  if (!isAllowed(req.access, req.method, req.path)) throw new ForbiddenError('Немає доступу до цього розділу');
  if (req.method !== 'GET' && req.access.canEdit === false && req.access.role !== 'superadmin') throw new ForbiddenError('Лише перегляд: редагувати не дозволено');
  next();
});

module.exports = { resolveTenant, bearer };
