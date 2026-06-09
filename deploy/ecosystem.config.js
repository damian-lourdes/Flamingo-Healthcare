/* =============================================================================
 * Flamingo Healthcare Platform — PM2 Ecosystem Config
 * Place at: /var/www/flamingo/deploy/ecosystem.config.js
 *
 * pm2 start deploy/ecosystem.config.js
 * pm2 save && pm2 startup
 * ============================================================================= */

const BASE = '/var/www/flamingo';

module.exports = {
  apps: [

    // ── flamingo-outbound (Node.js) ──────────────────────────────────────────
    // MocDoc polling, WhatsApp sends, webhook receiver, daily scheduler.
    // Single instance only — scheduler uses in-process state.
    {
      name:        'flamingo-outbound',
      script:      `${BASE}/outbound/server/index.js`,
      cwd:         `${BASE}/outbound`,
      instances:   1,
      exec_mode:   'fork',
      watch:       false,
      autorestart: true,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production', PORT: '3000' },
      out_file:        `${BASE}/logs/outbound-out.log`,
      error_file:      `${BASE}/logs/outbound-err.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      min_uptime:   '15s',
      max_restarts: 10,
      restart_delay: 5000,
    },

    // ── flamingo-api (FastAPI / Python) ─────────────────────────────────────
    // Dashboard API — reads PostgreSQL, proxies send actions to outbound.
    {
      name:        'flamingo-api',
      script:      `${BASE}/api/venv/bin/gunicorn`,
      args:        'app.main:app -w 2 -k uvicorn.workers.UvicornWorker --bind 127.0.0.1:8000 --timeout 30 --access-logfile -',
      cwd:         `${BASE}/api`,
      instances:   1,
      exec_mode:   'fork',
      interpreter: 'none',
      watch:       false,
      autorestart: true,
      max_memory_restart: '400M',
      env: { PYTHONUNBUFFERED: '1' },
      out_file:        `${BASE}/logs/api-out.log`,
      error_file:      `${BASE}/logs/api-err.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      min_uptime:   '15s',
      max_restarts: 10,
      restart_delay: 5000,
    },

  ],
};
