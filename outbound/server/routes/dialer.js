/* server/routes/dialer.js
 * Inbound call webhook + callback queue management.
 * Supports: Exotel, Knowlarity, MyOperator, Servetel, and generic payloads.
 */
const router         = require('express').Router();
const db             = require('../services/db');
const engagement     = require('../services/engagement');
const normalisePhone = require('../middleware/normalisePhone');

// ── Payload normaliser — maps any PBX format to internal format ───────────────
function normalisePayload(body) {
  // ── Exotel ──────────────────────────────────────────────────────────────────
  // Exotel sends form-encoded or JSON with these fields:
  if (body.CallSid || body.From || body.CallType) {
    const statusMap = {
      'completed':   'answered',
      'answered':    'answered',
      'no-answer':   'missed',
      'no_answer':   'missed',
      'busy':        'missed',
      'failed':      'missed',
      'canceled':    'abandoned',
      'cancelled':   'abandoned',
    };
    return {
      phone:       body.From        || body.CallFrom || body.caller_id_number || '',
      caller_name: body.CallerName  || null,
      status:      statusMap[(body.Status || body.CallType || '').toLowerCase()] || 'answered',
      duration_sec:parseInt(body.RecordingDuration || body.Duration || body.ConversationDuration || 0),
      agent:       body.To          || body.CallTo || null,
      ref_id:      body.CallSid     || null,
    };
  }

  // ── Knowlarity ───────────────────────────────────────────────────────────────
  if (body.event || body.call_id) {
    const statusMap = {
      'call_answered': 'answered',
      'call_missed':   'missed',
      'call_hangup':   'answered',
      'no_answer':     'missed',
    };
    return {
      phone:       body.caller_number || body.phone || '',
      caller_name: null,
      status:      statusMap[(body.event || '').toLowerCase()] || 'answered',
      duration_sec:parseInt(body.duration || 0),
      agent:       body.agent_number || null,
      ref_id:      body.call_id      || null,
    };
  }

  // ── Servetel ─────────────────────────────────────────────────────────────────
  if (body.callid || body.caller_id_number) {
    const statusMap = {
      'answered':  'answered',
      'missed':    'missed',
      'no-answer': 'missed',
      'busy':      'missed',
      'failed':    'abandoned',
    };
    return {
      phone:       body.caller_id_number || body.phone || '',
      caller_name: null,
      status:      statusMap[(body.call_status || '').toLowerCase()] || 'answered',
      duration_sec:parseInt(body.duration || 0),
      agent:       body.agent_number || null,
      ref_id:      body.callid       || null,
    };
  }

  // ── MyOperator ───────────────────────────────────────────────────────────────
  if (body.call_uuid || body.caller_id) {
    const statusMap = {
      'answered':  'answered',
      'missed':    'missed',
      'busy':      'missed',
      'not_answered': 'missed',
    };
    return {
      phone:       body.caller_id   || body.phone || '',
      caller_name: body.caller_name || null,
      status:      statusMap[(body.call_status || body.status || '').toLowerCase()] || 'answered',
      duration_sec:parseInt(body.duration || 0),
      agent:       body.agent       || null,
      ref_id:      body.call_uuid   || null,
    };
  }

  // ── Generic / manual ─────────────────────────────────────────────────────────
  return {
    phone:       body.phone        || body.From || body.caller || '',
    caller_name: body.caller_name  || null,
    status:      body.status       || 'answered',
    duration_sec:parseInt(body.duration_sec || body.duration || 0),
    agent:       body.agent        || null,
    ref_id:      body.ref_id       || null,
  };
}

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

// ── Exotel GET webhook handler ────────────────────────────────────────────────
// Exotel sends call data as GET query params (not POST body)
router.get('/call', async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately
  try {
    const d = req.query;
    // Map Exotel GET params to internal format
    const payload = {
      CallSid:    d.CallSid,
      From:       d.CallFrom || d.From,
      Status:     d.DialCallStatus || d.CallType,
      Duration:   d.DialCallDuration,
      To:         d.CallTo || d.To,
      CallType:   d.CallType,
    };
    console.log(`[dialer] Exotel GET: ${d.CallType} from ${d.CallFrom || d.From}`);
    // Only process completed calls, not call-attempt
    if (d.CallType !== 'call-attempt') {
      await processCall(payload);
    } else {
      console.log(`[dialer] call-attempt from ${d.CallFrom} — waiting for completion`);
    }
  } catch (e) {
    console.error('[dialer] GET call error:', e.message);
  }
});

// ── Shared call processor ─────────────────────────────────────────────────────
async function processCall(rawPayload) {
  const payload = normalisePayload(rawPayload);
  const { phone, caller_name, duration_sec, status, agent, ref_id } = payload;

  if (!phone) {
    console.warn('[dialer] No phone number in payload:', rawPayload);
    return;
  }

  const normPhone = normalisePhone(phone);

  // Skip call-attempt events — only process final status
  const callType = (rawPayload.CallType || '').toLowerCase();
  if (callType === 'call-attempt') {
    console.log(`[dialer] call-attempt from ${normPhone} — waiting for final status`);
    return;
  }

  await db.logCall({
    phone:       normPhone,
    callerName:  caller_name  || null,
    durationSec: duration_sec || null,
    status:      (status || 'answered').toLowerCase(),
    agent:       agent  || null,
    notes:       ref_id ? `ref:${ref_id}` : null,
  });

  await engagement.onIncomingCall({ phone: normPhone, callerName: caller_name || null });

  const finalStatus = (status || '').toLowerCase();
  if (finalStatus === 'missed' || finalStatus === 'no-answer' || finalStatus === 'busy') {
    await engagement.onMissedCall({ phone: normPhone, callerName: caller_name || null });
    console.log(`[dialer] Missed call from ${normPhone} — callback queued`);
  } else {
    console.log(`[dialer] ${status} call logged: ${normPhone}`);
  }
}

// ── Inbound call webhook (Exotel / Knowlarity / Servetel / MyOperator / generic)
router.post('/call', async (req, res) => {
  res.sendStatus(200);
  try {
    await processCall(req.body);
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
