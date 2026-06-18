/* server/middleware/requireRole.js
 * Gates a route to specific staff roles. Always mount AFTER requireAuth —
 * it reads req.role, which requireAuth is what sets.
 *
 * Usage:
 *   app.use('/api/templates', requireAuth, requireRole('admin'), templatesRoutes);
 * or, for a single route inside an otherwise open router:
 *   router.post('/camp', requireRole('admin'), async (req, res) => { ... });
 */
module.exports = function requireRole(...allowedRoles) {
  return function (req, res, next) {
    if (!req.role) {
      // Shouldn't happen if requireAuth ran first — fail closed either way.
      return res.status(401).json({ error: 'Unauthorized — please log in' });
    }
    if (!allowedRoles.includes(req.role)) {
      return res.status(403).json({ error: `Forbidden — requires role: ${allowedRoles.join(' or ')}` });
    }
    next();
  };
};
