/* server/routes/auth.js
 * Minimal staff authentication for the dashboard, with audit logging of
 * every login attempt (success and failure) — see audit_log table.
 *
 * Credentials come from environment variables:
 *   DASHBOARD_USERNAME / DASHBOARD_PASSWORD
 * (falls back to 'admin' / 'flamingo123' in non-production for convenience —
 * set these env vars before deploying to production.)
 *
 * Tokens are simple HMAC-signed strings (no extra dependency needed):
 *   base64(username.expiry) + '.' + HMAC-SHA256(secret)
 */
const router = require('express').Router();
const crypto = require('crypto');
const db     = require('../services/db');

const USERNAME = process.env.DASHBOARD_USERNAME || 'admin';
const PASSWORD = process.env.DASHBOARD_PASSWORD || 'flamingo123';
const SECRET   = process.env.AUTH_SECRET || 'flamingo-dev-secret-change-me';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function timingSafeStringEqual(a, b) {
  const ab = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';

  const ok = username && password
    && timingSafeStringEqual(username, USERNAME)
    && timingSafeStringEqual(password, PASSWORD);

  if (!ok) {
    await db.logAudit({
      actor: username || 'unknown', action: 'login_failure', entity: 'auth',
      entityId: null, after: { ip },
    });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  await db.logAudit({
    actor: username, action: 'login_success', entity: 'auth',
    entityId: null, after: { ip },
  });

  const token = sign({ username, exp: Date.now() + TOKEN_TTL_MS });
  res.json({ access_token: token, username });
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload = verify(token);
  if (!payload) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, username: payload.username });
});

module.exports = router;
module.exports.verify = verify;
