// MCP — POST /api/mcp (JSON-RPC 2.0). Авторизація: Bearer <Tenant.apiKey> (компанія береться з ключа)
// або Bearer MCP_SECRET + tenantId (slug або id) у query — для власника/Claude, крос-тенантно.
const express = require('express');
const { db } = require('@cal/db');
const { TOOLS, callTool } = require('@cal/mcp/src/tools');
const { handleJsonRpc } = require('@cal/mcp/src/jsonrpc');

const router = express.Router();

async function resolveCtx(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.header('authorization') || '');
  const token = match ? match[1].trim() : '';
  if (!token) return null;
  const byKey = await db.tenant.findUnique({ where: { apiKey: token } });
  if (byKey) return { tenant: byKey };
  if (process.env.MCP_SECRET && token === process.env.MCP_SECRET) {
    const ref = String(req.query.tenantId || req.query.tenant || '');
    if (!ref) return { tenant: null };
    const t = await db.tenant.findFirst({ where: { OR: [{ id: ref }, { slug: ref }] } });
    return { tenant: t };
  }
  return null;
}

router.post('/mcp', async (req, res) => {
  const ctx = await resolveCtx(req);
  if (!ctx) return res.status(401).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32000, message: 'Unauthorized' } });
  const body = req.body || {};
  // initialize/tools/list не потребують компанії; виклики інструментів — потребують.
  if (!ctx.tenant && body.method === 'tools/call') return res.json({ jsonrpc: '2.0', id: body.id ?? null, error: { code: -32602, message: 'Вкажіть tenantId (slug або id) у query' } });
  const response = await handleJsonRpc({ tools: TOOLS, callTool, ctx }, body);
  res.json(response || { jsonrpc: '2.0', id: null, result: null });
});

router.get('/mcp', (req, res) => res.json({ name: 'fineko-calendar-mcp', transport: 'POST JSON-RPC 2.0', tools: TOOLS.map((t) => t.name) }));

module.exports = router;
