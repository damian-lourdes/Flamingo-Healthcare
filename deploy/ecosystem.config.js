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
    // MocDoc polling, WhatsApp sends, webhook receiver, daily scheduler,
    // and the dashboard REST API (single backend — serves /api/* directly).
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

  ],
};
