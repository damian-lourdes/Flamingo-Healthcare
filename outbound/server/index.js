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
const requireAuth  = require('./middleware/requireAuth');
const db         = require('./services/db');
const wa         = require('./services/whatsapp');
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
const authRoutes       = require('./routes/auth');

// ── App setup ─────────────────────────────────────────────────────────────────
const app = express();

// CORS — the dashboard frontend is deployed on a different Railway domain
// than this API, so every request is cross-origin. Requests carrying an
// Authorization header (i.e. every authenticated dashboard call) trigger a
// CORS preflight (OPTIONS) first. This MUST be the very first middleware:
//  - it answers OPTIONS preflights directly (before requireAuth would 401
//    them — preflights never carry the Authorization header)
//  - it sets Access-Control-Allow-Origin on every response (including error
//    responses), since a response missing that header is blocked by the
//    browser regardless of its status code or content.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

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
// /api/auth must be mounted first, and is never itself behind requireAuth —
// login has to be reachable unauthenticated. Also aliased at /auth (no /api
// prefix) — that's the path the current frontend build (client.ts) calls.
app.use('/api/auth',       authRoutes);     // POST /api/auth/login, GET /api/auth/me
app.use('/auth',           authRoutes);     // alias: POST /auth/login, GET /auth/me

// Specific /api/* mounts are registered BEFORE the blanket '/api' catch-all
// below. This matters for /api/dialer in particular: requireAuth short-
// circuits with a 401 response (it doesn't call next() on failure), so if
// the blanket '/api' mount matched first it would block the open dialer
// webhook (/api/dialer/call) before dialerRoutes ever saw it. Registering
// '/api/dialer' first means that mount — not the blanket one — handles it,
// and dialerRoutes' own per-route requireAuth still protects /stats, /calls,
// /callbacks, /recalls, /followups and /callback/:id/done.
app.use('/api/dashboard',  requireAuth, dashboardRoutes); // alias: frontend calls /api/dashboard/*
app.use('/api/dialer',     dialerRoutes);                 // alias: frontend calls /api/dialer/*
app.use('/api/engagement', requireAuth, engagementRoutes);
app.use('/api/broadcast',  requireAuth, broadcastRoutes);
app.use('/api/templates',  requireAuth, require('./routes/templates'));
app.use('/api/leads',      requireAuth, require('./routes/leads'));
app.use('/api/scheduler',  requireAuth, schedulerRoutes);

// Blanket fallback for the original (non-aliased) dashboard paths, e.g.
// /api/state, /api/patients, /api/doctors, /api/audit-log.
app.use('/api',            requireAuth, dashboardRoutes);

app.use('/dialer',         dialerRoutes);   // direct: POST /dialer/call (no auth — server-to-server)
app.use('/hooks/dialer',   dialerRoutes);   // Exotel webhook: GET /hooks/dialer/call (no auth)
app.use('/webhooks',       webhookRoutes);  // legacy
app.use('/hooks',          webhookRoutes);  // MocDoc + Exotel webhooks (new path)


// Health check — used by pm2, load balancers, uptime monitors
app.get('/health', async (_req, res) => {
  const waHealth      = wa.getHealth();
  const deliveryStats = await db.getDeliveryStats().catch(() => []);

  const statusObj = {
    status:        waHealth.healthy ? 'ok' : 'degraded',
    service:       'flamingo-outbound',
    env:           config.env,
    uptime:        Math.floor(process.uptime()),
    whatsapp: {
      healthy:          waHealth.healthy,
      consecutiveFails: waHealth.consecutiveFails,
      lastSuccess:      waHealth.lastSuccess,
      lastError:        waHealth.lastError,
      lastErrorAt:      waHealth.lastErrorAt,
    },
    delivery: deliveryStats.reduce((acc, r) => {
      acc[r.status] = parseInt(r.count);
      return acc;
    }, {}),
  };

  res.status(waHealth.healthy ? 200 : 503).json(statusObj);
});

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
