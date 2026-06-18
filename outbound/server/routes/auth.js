/* server/routes/auth.js
 * Staff authentication for the dashboard, with audit logging of every
 * login attempt (success and failure) — see audit_log table.
 *
 * Credentials live in the staff_users table (services/db.js), checked with
 * bcrypt. The very first admin account is bootstrapped once at boot from
 * DASHBOARD_USERNAME/DASHBOARD_PASSWORD (see db.seedDefaultAdminIfEmpty) —
 * everyone after that is created via POST /api/staff.
 *
 * Tokens are simple HMAC-signed strings (no extra dependency needed):
 *   base64(payload) + '.' + HMAC-SHA256(secret)
 * payload now carries { username, role, exp } — role is what
 * middleware/requireRole.js checks on protected routes.
 */
const router = require('express').Router();
const crypto = require('crypto');
const db     = require('../services/db');

const SECRET = process.env.AUTH_SECRET || 'flamingo-dev-secret-change-me';
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

// ── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';

  const user = username && password ? await db.verifyStaffUser(username, password) : null;

  if (!user) {
    await db.logAudit({
      actor: username || 'unknown', action: 'login_failure', entity: 'auth',
      entityId: null, after: { ip },
    });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  await db.logAudit({
    actor: user.username, action: 'login_success', entity: 'auth',
    entityId: null, after: { ip },
  });

  const token = sign({ username: user.username, role: user.role, exp: Date.now() + TOKEN_TTL_MS });
  res.json({ access_token: token, username: user.username, role: user.role });
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload = verify(token);
  if (!payload) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, username: payload.username, role: payload.role });
});

module.exports = router;
module.exports.verify = verify;
