// MCP-інструменти календаря: один файл TOOLS[] + callTool(name, args, ctx). ctx.tenant — компанія, до якої прив'язаний ключ.
// Записи від ботів/Claude йдуть у режимі «bot»: лише у вільні слоти послуги, без накладок.
const { db } = require('@cal/db');
const core = require('@cal/core');
const { ValidationError, NotFoundError } = require('@cal/errors');

function safeJsonStringify(v) {
  return JSON.stringify(v, (k, val) => (typeof val === 'bigint' ? val.toString() : val), 2);
}

const str = (d) => ({ type: 'string', description: d });
const TOOLS = [
  { name: 'calendar_list_services', description: 'Послуги компанії (id, назва, тривалість, ціна, які співробітники виконують).', inputSchema: { type: 'object', properties: {} } },
  { name: 'calendar_list_resources', description: 'Співробітники/майстри/експерти, до яких можна записатись.', inputSchema: { type: 'object', properties: {} } },
  { name: 'calendar_get_free_slots', description: 'Вільні вікна для запису. Якщо послуга лише одна, serviceId можна не вказувати. Дати локальні (YYYY-MM-DD) за поясом компанії; за замовчуванням від сьогодні на 14 днів.', inputSchema: { type: 'object', properties: { serviceId: str('id послуги'), resourceId: str('конкретний співробітник (необовʼязково)'), from: str('YYYY-MM-DD'), to: str('YYYY-MM-DD'), days: { type: 'number' }, limit: { type: 'number', description: 'макс. кількість слотів' } } } },
  { name: 'calendar_create_booking', description: 'Записати клієнта на вільний слот (start — точне значення поля start зі слота). Повертає 409/slot_taken, якщо час щойно зайняли: тоді запропонуйте інші слоти. Повторний виклик із тим самим clientTelegramId і start не створює дубль.', inputSchema: { type: 'object', required: ['start'], properties: { start: str('ISO-час початку зі слота'), serviceId: str('id послуги'), resourceId: str('співробітник (необовʼязково)'), clientName: str('імʼя клієнта'), clientPhone: str('телефон'), clientTelegram: str('@username'), clientTelegramId: str('Telegram id клієнта'), source: str('звідки запис, напр. slug воронки'), note: str('коментар') } } },
  { name: 'calendar_find_bookings', description: 'Знайти записи: за Telegram id клієнта, імʼям/телефоном, періодом, статусом. upcoming=true — лише майбутні.', inputSchema: { type: 'object', properties: { clientTelegramId: str('Telegram id'), q: str('імʼя/телефон/username'), from: str('YYYY-MM-DD'), to: str('YYYY-MM-DD'), status: str('confirmed|cancelled|completed|no_show'), upcoming: { type: 'boolean' } } } },
  { name: 'calendar_cancel_booking', description: 'Скасувати запис (звільняє слот). Передайте clientTelegramId, щоб клієнт міг скасувати лише свій запис.', inputSchema: { type: 'object', required: ['bookingId'], properties: { bookingId: str('id запису'), clientTelegramId: str('Telegram id клієнта'), reason: str('причина') } } },
  { name: 'calendar_reschedule_booking', description: 'Перенести запис на інший вільний слот (start зі списку слотів).', inputSchema: { type: 'object', required: ['bookingId', 'start'], properties: { bookingId: str('id запису'), start: str('ISO-час нового слота'), resourceId: str('інший співробітник (необовʼязково)'), clientTelegramId: str('Telegram id клієнта') } } },
  { name: 'calendar_get_day', description: 'Зведення дня: вікна, закриття, записи.', inputSchema: { type: 'object', required: ['date'], properties: { date: str('YYYY-MM-DD'), resourceId: str('співробітник') } } },
  { name: 'calendar_get_month', description: 'Зведення місяця: по днях години вікон, зайнято, вільно, кількість записів.', inputSchema: { type: 'object', required: ['month'], properties: { month: str('YYYY-MM'), resourceId: str('співробітник') } } },
  { name: 'calendar_set_availability', description: 'Задати тижневий графік (вільні вікна) співробітника: замінює всі вікна. weekday 1=Пн…7=Нд, час у хвилинах від півночі (11:00-18:00 = 660-1080).', inputSchema: { type: 'object', required: ['resourceId', 'windows'], properties: { resourceId: str('співробітник'), windows: { type: 'array', items: { type: 'object', required: ['weekday', 'startMin', 'endMin'], properties: { weekday: { type: 'number' }, startMin: { type: 'number' }, endMin: { type: 'number' } } } } } } },
  { name: 'calendar_create_resource', description: 'Додати співробітника/майстра/експерта.', inputSchema: { type: 'object', required: ['name'], properties: { name: str('імʼя'), color: str('#rrggbb') } } },
  { name: 'calendar_create_service', description: 'Додати послугу.', inputSchema: { type: 'object', required: ['name', 'durationMin'], properties: { name: str('назва'), durationMin: { type: 'number' }, bufferMin: { type: 'number' }, stepMin: { type: 'number' }, price: { type: 'number' }, resourceIds: { type: 'array', items: { type: 'string' } } } } },
  { name: 'calendar_add_time_off', description: 'Закрити час: відпустка, перерва, вихідний. Без resourceId закриває всю компанію. start/end — ISO.', inputSchema: { type: 'object', required: ['start', 'end'], properties: { start: str('ISO'), end: str('ISO'), resourceId: str('співробітник'), reason: str('причина') } } },
];

const READ_TOOL_NAMES = new Set(['calendar_list_services', 'calendar_list_resources', 'calendar_get_free_slots', 'calendar_find_bookings', 'calendar_get_day', 'calendar_get_month']);

async function callTool(name, args, ctx) {
  const tenant = ctx && ctx.tenant;
  if (!tenant) throw new ValidationError('Компанія не визначена (tenant)');
  const a = args || {};
  switch (name) {
    case 'calendar_list_services': {
      const rows = await db.service.findMany({ where: { tenantId: tenant.id, active: true }, include: { resources: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
      return rows.map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin, price: s.price, resourceIds: s.resources.map((r) => r.resourceId) }));
    }
    case 'calendar_list_resources': {
      const rows = await db.resource.findMany({ where: { tenantId: tenant.id, active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
      return rows.map((r) => ({ id: r.id, name: r.name }));
    }
    case 'calendar_get_free_slots': return core.getFreeSlots(tenant, a);
    case 'calendar_create_booking': {
      const r = await core.createBooking(tenant, { ...a, source: a.source || 'mcp' }, { mode: 'bot', actor: 'mcp' });
      return { ...r.booking, existing: r.existing };
    }
    case 'calendar_find_bookings': return core.listBookings(tenant, a);
    case 'calendar_cancel_booking': return core.cancelBooking(tenant, a.bookingId, { clientTelegramId: a.clientTelegramId, reason: a.reason });
    case 'calendar_reschedule_booking': return core.rescheduleBooking(tenant, a.bookingId, { start: a.start, resourceId: a.resourceId, clientTelegramId: a.clientTelegramId }, { mode: 'bot' });
    case 'calendar_get_day': return core.getDayView(tenant, a.date, { resourceId: a.resourceId });
    case 'calendar_get_month': return core.getMonthView(tenant, a.month, { resourceId: a.resourceId });
    case 'calendar_set_availability': return core.setWindows(tenant, a.resourceId, a.windows);
    case 'calendar_create_resource': {
      if (!String(a.name || '').trim()) throw new ValidationError('name обовʼязкове');
      const r = await db.resource.create({ data: { tenantId: tenant.id, name: String(a.name).trim(), color: /^#[0-9a-f]{6}$/i.test(a.color || '') ? a.color : '#0ea5e9' } });
      return { id: r.id, name: r.name };
    }
    case 'calendar_create_service': {
      if (!String(a.name || '').trim()) throw new ValidationError('name обовʼязкове');
      const ids = Array.isArray(a.resourceIds) ? a.resourceIds : [];
      const own = await db.resource.findMany({ where: { tenantId: tenant.id, id: { in: ids } }, select: { id: true } });
      const s = await db.service.create({ data: { tenantId: tenant.id, name: String(a.name).trim(), durationMin: Math.max(5, Math.min(Number(a.durationMin) || 60, 720)), bufferMin: Number(a.bufferMin) || 0, stepMin: a.stepMin ? Number(a.stepMin) : null, price: a.price ? Number(a.price) : null, resources: { create: own.map((r) => ({ resourceId: r.id })) } } });
      return { id: s.id, name: s.name };
    }
    case 'calendar_add_time_off': {
      const startAt = new Date(a.start); const endAt = new Date(a.end);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) throw new ValidationError('start/end: коректний інтервал ISO');
      if (a.resourceId && !(await db.resource.findFirst({ where: { id: a.resourceId, tenantId: tenant.id } }))) throw new NotFoundError('Resource', a.resourceId);
      const t = await db.timeOff.create({ data: { tenantId: tenant.id, resourceId: a.resourceId || null, startAt, endAt, reason: String(a.reason || '') } });
      return { id: t.id };
    }
    default: throw new ValidationError(`Невідомий інструмент: ${name}`);
  }
}

module.exports = { TOOLS, READ_TOOL_NAMES, callTool, safeJsonStringify };
