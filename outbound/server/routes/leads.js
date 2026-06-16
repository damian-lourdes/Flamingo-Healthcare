const express = require('express');
const router = express.Router();
const db = require('../services/db');
const config = require('../config');
const q = (s, p) => db.pool.query(s, p).then(r => r.rows);

// GET /api/leads — open leads
router.get('/', async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT id, phone, name, lead_status, lead_source, referred_by, assigned_to, next_action_at, last_contact
       FROM patient_profiles WHERE lifecycle_stage='lead'
       ORDER BY next_action_at NULLS LAST, id DESC`, []);
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/leads/:phone — lead detail + unified call/WhatsApp timeline
router.get('/:phone', async (req, res, next) => {
  try {
    const phone = req.params.phone;
    const lead = (await q(`SELECT * FROM patient_profiles WHERE phone=$1`, [phone]))[0] || null;
    const calls = await q(
      `SELECT status, agent, called_at AS at FROM dialer_calls WHERE phone=$1 ORDER BY called_at DESC LIMIT 30`, [phone]);
    const msgs = await q(
      `SELECT trigger_type, message, sent_at AS at FROM outbound_messages WHERE phone=$1 ORDER BY sent_at DESC LIMIT 30`, [phone]);
    const timeline = [
      ...calls.map(c => ({ kind: 'call', label: `Call · ${c.status || 'logged'}${c.agent ? ' · ' + c.agent : ''}`, at: c.at })),
      ...msgs.map(m => ({ kind: 'message', label: `WhatsApp${m.trigger_type ? ' · ' + m.trigger_type : ''}`, at: m.at, text: m.message })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    res.json({ lead, timeline });
  } catch (e) { next(e); }
});

// POST /api/leads — Add-lead form
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

// POST /api/leads/:phone/stage — move pipeline stage
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

// POST /api/leads/:phone/call — Exotel click-to-call (connects agent -> lead)
router.post('/:phone/call', async (req, res, next) => {
  try {
    const to = req.params.phone;
    const c = config.exotel || {};
    const agent = req.body.agentNumber || c.agentNumber;
    if (!c.sid || !c.apiKey || !c.apiToken || !c.subdomain || !c.callerId || !agent) {
      return res.status(400).json({ success: false,
        message: 'Exotel outbound not configured. Set EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_SUBDOMAIN, EXOTEL_CALLER_ID and an agent number.' });
    }
    const url = `https://${c.subdomain}/v1/Accounts/${c.sid}/Calls/connect.json`;
    const body = new URLSearchParams({ From: agent, To: to, CallerId: c.callerId, CallType: 'trans' });
    const auth = Buffer.from(`${c.apiKey}:${c.apiToken}`).toString('base64');
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const data = await r.json().catch(() => ({}));
    await db.logCall({ phone: to, status: 'initiated', agent }).catch(() => {});
    res.json({ success: r.ok, message: r.ok ? 'Calling — your phone will ring first, then connect to the lead.' : 'Exotel rejected the call.', exotel: data });
  } catch (e) { next(e); }
});

module.exports = router;
