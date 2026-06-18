/* server/routes/staff.js
 * Admin-only staff account management — list, create, deactivate/reactivate.
 * Mounted behind requireAuth + requireRole('admin') in index.js, so every
 * route here can assume the caller is already an admin.
 */
const router = require('express').Router();
const db = require('../services/db');

const VALID_ROLES = ['admin', 'front_desk'];

// GET /api/staff — list every account (active and deactivated)
router.get('/', async (req, res, next) => {
  try { res.json(await db.listStaffUsers()); }
  catch (e) { next(e); }
});

// POST /api/staff — create a new account
router.post('/', async (req, res, next) => {
  try {
    const { username, password, role, displayName } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'username and password are required' });
    }
    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'password must be at least 8 characters' });
    }
    const existing = await db.getUserByUsername(username);
    if (existing) {
      return res.status(409).json({ success: false, message: 'That username is already taken' });
    }
    const user = await db.createStaffUser({ username, password, role: role || 'front_desk', displayName, actor: req.actor });
    await db.logAudit({ actor: req.actor, action: 'create', entity: 'staff_users', entityId: username, after: { role: user.role } });
    res.json({ success: true, user });
  } catch (e) { next(e); }
});

// POST /api/staff/:username/active — { active: true | false }
router.post('/:username/active', async (req, res, next) => {
  try {
    const { active } = req.body || {};
    if (typeof active !== 'boolean') {
      return res.status(400).json({ success: false, message: 'active must be true or false' });
    }
    if (req.params.username === req.actor && active === false) {
      return res.status(400).json({ success: false, message: "You can't deactivate your own account while logged in as it." });
    }
    await db.setStaffUserActive(req.params.username, active, req.actor);
    await db.logAudit({ actor: req.actor, action: active ? 'reactivate' : 'deactivate', entity: 'staff_users', entityId: req.params.username, after: { active } });
    res.json({ success: true });
  } catch (e) { next(e); }
});

module.exports = router;
