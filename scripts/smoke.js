// Димове тестування працюючого API (локально або на проді): CAL_URL і CAL_KEY (apiKey компанії).
//   CAL_URL=http://localhost:4800 CAL_KEY=cal_... node scripts/smoke.js
// Створює тестовий запис, перевіряє накладку, ідемпотентність, день/місяць, перенос, скасування, MCP, ізоляцію ключів. Прибирає за собою.
const BASE = process.env.CAL_URL || 'http://localhost:4800';
const KEY = process.env.CAL_KEY;
if (!KEY) { console.error('CAL_KEY не задано'); process.exit(1); }

let failed = 0;
const check = (name, cond, extra) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` ${extra ? JSON.stringify(extra) : ''}`}`); if (!cond) failed++; };
async function call(method, path, body, key = KEY) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
const rpc = (method, params, key = KEY) => call('POST', '/api/mcp', { jsonrpc: '2.0', id: 1, method, params }, key);

(async () => {
  const health = await call('GET', '/health', null, null);
  check('health', health.status === 200 && health.json.ok);

  const noAuth = await call('GET', '/api/slots', null, null);
  check('без ключа → 401', noAuth.status === 401);
  const badKey = await call('GET', '/api/slots', null, 'cal_wrong');
  check('чужий ключ → 401', badKey.status === 401);

  const slots = await call('GET', '/api/slots?days=10', null);
  const list = slots.json.data && slots.json.data.slots;
  check('слоти є', slots.status === 200 && Array.isArray(list) && list.length > 0, slots.json);
  if (!list || !list.length) process.exit(1);
  const s = list[1] || list[0];
  const tg = `smoke-${Date.now()}`;

  const b1 = await call('POST', '/api/bookings', { start: s.start, clientName: 'Смоук Тест', clientTelegramId: tg, source: 'smoke' });
  check('запис створено', b1.status === 201 && b1.json.data && b1.json.data.status === 'confirmed', b1.json);
  const id = b1.json.data && b1.json.data.id;

  const b2 = await call('POST', '/api/bookings', { start: s.start, clientName: 'Інша людина', clientTelegramId: `${tg}-2` });
  check('той самий слот іншому → 409 slot_taken', b2.status === 409 && b2.json.error.context && b2.json.error.context.reason === 'slot_taken', b2.json);

  const b3 = await call('POST', '/api/bookings', { start: s.start, clientName: 'Смоук Тест', clientTelegramId: tg });
  check('повторний запис тієї ж людини → без дубля (existing)', b3.status === 200 && b3.json.existing === true && b3.json.data.id === id, b3.json);

  const after = await call('GET', '/api/slots?days=10');
  check('слот зник зі списку', !after.json.data.slots.some((x) => x.start === s.start));

  const day = await call('GET', `/api/calendar/day?date=${s.date}`);
  check('день показує запис і вікна', day.json.data && day.json.data.bookings.some((b) => b.id === id) && day.json.data.windows.length > 0, day.json);
  const month = await call('GET', `/api/calendar/month?month=${s.date.slice(0, 7)}`);
  const md = month.json.data && month.json.data.days.find((d) => d.date === s.date);
  check('місяць: на дні 1 запис, вільно менше за вікно', md && md.bookings >= 1 && md.freeMin < md.windowMin, md);

  const found = await call('GET', `/api/bookings?clientTelegramId=${tg}&upcoming=1`);
  check('пошук запису за Telegram id', found.json.data && found.json.data.length === 1);

  const other = list.find((x) => x.start !== s.start);
  const re = await call('POST', `/api/bookings/${id}/reschedule`, { start: other.start, clientTelegramId: tg });
  check('перенос на інший слот', re.status === 200 && re.json.data.start === other.start, re.json);
  const reBad = await call('POST', `/api/bookings/${id}/reschedule`, { start: other.start, clientTelegramId: 'not-owner' });
  check('чужий clientTelegramId не переносить → 404', reBad.status === 404);

  const cancelBad = await call('POST', `/api/bookings/${id}/cancel`, { clientTelegramId: 'not-owner' });
  check('чужий clientTelegramId не скасовує → 404', cancelBad.status === 404);
  const cancel = await call('POST', `/api/bookings/${id}/cancel`, { clientTelegramId: tg, reason: 'smoke' });
  check('скасування', cancel.status === 200 && cancel.json.data.status === 'cancelled', cancel.json);
  const freed = await call('GET', '/api/slots?days=10');
  check('слот знову вільний після скасування', freed.json.data.slots.some((x) => x.start === other.start));

  if (process.env.SKIP_MCP_HTTP) {
    console.log('(MCP по HTTP пропущено: SKIP_MCP_HTTP)');
    console.log(failed ? `Провалено: ${failed}` : 'Усе гаразд');
    process.exit(failed ? 1 : 0);
  }
  const tools = await rpc('tools/list');
  check('MCP tools/list', tools.json.result && tools.json.result.tools.length >= 10, tools.json);
  const mslots = await rpc('tools/call', { name: 'calendar_get_free_slots', arguments: { days: 3, limit: 2 } });
  check('MCP calendar_get_free_slots', mslots.json.result && JSON.parse(mslots.json.result.content[0].text).slots.length === 2, mslots.json);
  const mbad = await rpc('tools/list', undefined, 'cal_wrong');
  check('MCP без валідного ключа → 401', mbad.status === 401);

  console.log(failed ? `\nПровалено: ${failed}` : '\nУсе гаразд');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
