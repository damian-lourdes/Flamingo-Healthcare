/* server/routes/dialer.js
 * Inbound call webhook + callback queue management.
 * Wire your PBX (Exotel / Knowlarity / MyOperator) to POST /dialer/call.
 */
const router         = require('express').Router();
const db             = require('../services/db');
const engagement     = require('../services/engagement');
const normalisePhone = require('../middleware/normalisePhone');

// ── Stats + queue ─────────────────────────────────────────────────────────────
router.get('/stats', async (_req, res, next) => {
  try { res.json(await db.getDialerStats()); }
  catch (e) { next(e); }
});

router.get('/calls', async (req, res, next) => {
  try { res.json(await db.getCalls(req.query.limit || 200)); }
  catch (e) { next(e); }
});

router.get('/callbacks', async (_req, res, next) => {
  try { res.json(await db.getCallbackQueue()); }
  catch (e) { next(e); }
});

// ── Inbound call webhook ──────────────────────────────────────────────────────
router.post('/call', async (req, res) => {
  // Acknowledge immediately — PBX has short timeout
  res.sendStatus(200);
  try {
    const { phone, caller_name, duration_sec, status, agent, notes } = req.body;
    if (!phone || !status) return;

    const normPhone = normalisePhone(phone);
    await db.logCall({
      phone:       normPhone,
      callerName:  caller_name  || null,
      durationSec: parseInt(duration_sec) || null,
      status:      status.toLowerCase(),
      agent:       agent  || null,
      notes:       notes  || null,
    });

    await engagement.onIncomingCall({ phone: normPhone, callerName: caller_name || null });

    if (status.toLowerCase() === 'missed') {
      await engagement.onMissedCall({ phone: normPhone, callerName: caller_name || null });
      console.log(`[dialer] Missed call from ${phone} — WhatsApp sent`);
    }

    console.log(`[dialer] ${status} call logged from ${phone}`);
  } catch (e) {
    console.error('[dialer] call error:', e.message);
  }
});

// ── Mark callback done ────────────────────────────────────────────────────────
router.post('/callback/:id/done', async (req, res, next) => {
  try {
    await db.markCallbackDone(req.params.id, req.body.status || 'called_back');
    res.json({ success: true });
  } catch (e) { next(e); }
});

module.exports = router;
