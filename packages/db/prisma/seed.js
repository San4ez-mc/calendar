// Початкові дані: компанія «Олександр Мацук (FINEKO)», співробітник «Олександр», послуга «Консультація», Пн-Пт 11:00-18:00.
// Ідемпотентно: повторний запуск нічого не дублює. Ключ API друкується лише при створенні компанії (або з --show-key).
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const db = new PrismaClient();
const SLUG = process.env.SEED_TENANT_SLUG || 'matsuk';

(async () => {
  let tenant = await db.tenant.findUnique({ where: { slug: SLUG } });
  let created = false;
  if (!tenant) {
    tenant = await db.tenant.create({ data: { name: 'Олександр Мацук (FINEKO)', slug: SLUG, apiKey: `cal_${crypto.randomBytes(24).toString('hex')}`, timezone: 'Europe/Kyiv', minNoticeMin: 180, horizonDays: 30 } });
    created = true;
  }
  let resource = await db.resource.findFirst({ where: { tenantId: tenant.id, name: 'Олександр' } });
  if (!resource) resource = await db.resource.create({ data: { tenantId: tenant.id, name: 'Олександр', color: '#0ea5e9' } });

  let service = await db.service.findFirst({ where: { tenantId: tenant.id, name: 'Консультація' } });
  if (!service) service = await db.service.create({ data: { tenantId: tenant.id, name: 'Консультація', durationMin: 60, bufferMin: 0, resources: { create: [{ resourceId: resource.id }] } } });

  const has = await db.availabilityWindow.count({ where: { tenantId: tenant.id, resourceId: resource.id } });
  if (!has) {
    await db.availabilityWindow.createMany({ data: [1, 2, 3, 4, 5].map((weekday) => ({ tenantId: tenant.id, resourceId: resource.id, weekday, startMin: 11 * 60, endMin: 18 * 60 })) });
  }
  console.log(JSON.stringify({ tenant: tenant.slug, tenantId: tenant.id, created, resourceId: resource.id, serviceId: service.id, windowsAdded: !has }));
  if (created || process.argv.includes('--show-key')) console.log(`apiKey: ${tenant.apiKey}`);
  await db.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
