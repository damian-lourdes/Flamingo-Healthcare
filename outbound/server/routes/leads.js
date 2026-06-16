const express = require('express');
const router = express.Router();
const db = require('../services/db');
const q = (s, p) => db.pool.query(s, p).then(r => r.rows);

// GET /api/leads — open leads (grouped client-side by lead_status)
router.get('/', async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT id, phone, name, lead_status, lead_source, referred_by, assigned_to, next_action_at, last_contact
       FROM patient_profiles WHERE lifecycle_stage='lead'
       ORDER BY next_action_at NULLS LAST, id DESC`, []);
    res.json(rows);
  } catch (e) { next(e); }
});

// POST /api/leads — Add-lead form (walk-ins, referrals, manual)
router.post('/', async (req, res, next) => {
  try {
    const { phone, name, source, referredBy, assignedTo, nextActionAt, notes } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'phone required' });
    await db.tagLead({ phone, name, source: source || 'walkin', referredBy: referredBy || null });
    await db.pool.query(
      `UPDATE patient_profiles SET assigned_to=$2, next_action_at=$3, lead_notes=$4 WHERE phone=$1`,
      [phone, assignedTo || null, nextActionAt || null, notes || null]);
    await db.logAudit({ actor: req.actor || 'dashboard', action: 'create', entity: 'lead', entityId: phone, after: req.body });
    res.json({ success: true });
  } catch (e) { next(e); }
});

// POST /api/leads/:phone/stage — move between pipeline columns
router.post('/:phone/stage', async (req, res, next) => {
  try {
    const { status, assignedTo, nextActionAt } = req.body;
    await db.pool.query(
      `UPDATE patient_profiles SET lead_status=$2,
         assigned_to=COALESCE($3,assigned_to), next_action_at=COALESCE($4,next_action_at)
       WHERE phone=$1 AND lifecycle_stage='lead'`,
      [req.params.phone, status, assignedTo || null, nextActionAt || null]);
    await db.logAudit({ actor: req.actor || 'dashboard', action: 'update', entity: 'lead', entityId: req.params.phone, after: { status } });
    res.json({ success: true });
  } catch (e) { next(e); }
});

module.exports = router;
