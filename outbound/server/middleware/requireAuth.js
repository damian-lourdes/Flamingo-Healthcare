/* server/middleware/requireAuth.js
 * Protects dashboard API routes — requires a valid Bearer token issued by
 * POST /api/auth/login. Does NOT apply to:
 *   - /api/auth/*        (login itself must be reachable unauthenticated)
 *   - MocDoc/Exotel webhooks (/hooks/*, /webhooks/*, /dialer/call) — external
 *     systems can't send a dashboard session token.
 *   - /health, static assets, SPA fallback.
 *
 * On success, sets req.actor = the logged-in username (used for audit_log
 * entries on master-table writes).
 */
const { verify } = require('../routes/auth');

module.exports = function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload = verify(token);

  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized — please log in' });
  }

  req.actor = payload.username;
  next();
};
