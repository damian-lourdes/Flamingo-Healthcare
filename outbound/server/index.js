/* server/index.js
 * Flamingo Healthcare — Outbound WhatsApp Engagement Platform
 * Entry point: boots Express, wires all routes, starts background jobs.
 */
const path       = require('path');
const express    = require('express');
const helmet     = require('helmet');

const config     = require('./config');
const logger     = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');
const db         = require('./services/db');
const sync       = require('./services/mocdoc-sync');
const engagement = require('./services/engagement');
const scheduler  = require('./services/scheduler');

// ── Route modules ─────────────────────────────────────────────────────────────
const dashboardRoutes  = require('./routes/dashboard');
const dialerRoutes     = require('./routes/dialer');
const engagementRoutes = require('./routes/engagement');
const broadcastRoutes  = require('./routes/broadcast');
const webhookRoutes    = require('./routes/webhooks');
const schedulerRoutes  = require('./routes/scheduler');

// ── App setup ─────────────────────────────────────────────────────────────────
const app = express();

// Security headers (relaxed CSP for inline dashboard scripts/styles)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
logger(app);

// Serve static dashboard
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api',            dashboardRoutes);
app.use('/dialer',         dialerRoutes);
app.use('/api/engagement', engagementRoutes);
app.use('/api/broadcast',  broadcastRoutes);
app.use('/webhooks',       webhookRoutes);  // legacy
app.use('/hooks',          webhookRoutes);  // MocDoc + Exotel webhooks (new path)
app.use('/api/scheduler',  schedulerRoutes);

// Health check — used by pm2, load balancers, uptime monitors
app.get('/health', (_req, res) => res.json({
  status:  'ok',
  service: 'flamingo-outbound',
  env:     config.env,
  uptime:  Math.floor(process.uptime()),
}));

// SPA fallback — serve index.html for any unmatched route
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Centralised error handler (must be last)
app.use(errorHandler);

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(config.port, async () => {
  console.log(`\n🦩 Flamingo Outbound [${config.env}] running on :${config.port}`);
  console.log(`   Dashboard : http://localhost:${config.port}`);
  console.log(`   Health    : http://localhost:${config.port}/health`);
  console.log(`   Dialer    : POST http://localhost:${config.port}/dialer/call\n`);
});

// ── Background jobs ───────────────────────────────────────────────────────────

// MocDoc polling — every 60s
// Comment this out once MocDoc webhooks go live (June 2026)
sync.start();

// Recall + follow-up queue — every 30 min
setInterval(() => engagement.runJobs().catch(console.error), 30 * 60 * 1000);
setTimeout(()  => engagement.runJobs().catch(console.error), 5_000); // warm start

// Daily 9 AM jobs — birthdays, anniversaries, festivals, re-engagement
scheduleDailyAt(9, 0, () => scheduler.runDailyJobs().catch(console.error));

// ── Helpers ───────────────────────────────────────────────────────────────────
function scheduleDailyAt(hour, minute, fn) {
  function msUntilNext() {
    const now  = new Date();
    const next = new Date();
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }
  function schedule() {
    setTimeout(() => { fn(); setInterval(fn, 24 * 60 * 60 * 1000); }, msUntilNext());
  }
  schedule();
  console.log(`[scheduler] Daily jobs scheduled for ${hour}:${String(minute).padStart(2,'0')} AM`);
}
