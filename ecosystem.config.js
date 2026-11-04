// PM2 — той самий підхід, що CRM/Flows (без Docker). MCP живе всередині calendar-api (/api/mcp), окремого процесу не потрібно.
module.exports = {
  apps: [
    {
      name: 'calendar-api',
      script: 'apps/api/src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env_production: { NODE_ENV: 'production' },
    },
  ],
};
