/* server/routes/dialer.js
 * Inbound call webhook + callback queue management.
 * Supports: Exotel, Knowlarity, MyOperator, Servetel, and generic payloads.
 */
const router         = require('express').Router();
const { Readable }   = require('stream');
const db             = require('../services/db');
const engagement     = require('../services/engagement');
const normalisePhone = require('../middleware/normalisePhone');
const requireAuth    = require('../middleware/requireAuth');
const config         = require('../config');

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
    // call-attempt fires the moment the call comes in, before Connect runs —
    // on a trial Exotel account the Connect leg never completes, so this is
    // often the ONLY event we'll ever get for a given call.
    const callType = (body.CallType || '').toLowerCase();
    const status = callType === 'call-attempt'
      ? 'received'
      : (statusMap[(body.Status || body.CallType || '').toLowerCase()] || 'answered');
    return {
      phone:       body.From        || body.CallFrom || body.caller_id_number || '',
      caller_name: body.CallerName  || null,
      status,
      duration_sec:parseInt(body.RecordingDuration || body.Duration || body.ConversationDuration || 0),
      agent:       body.To          || body.CallTo || null,
      ref_id:      body.CallSid     || null,
      // Exotel includes the recording URL on the call-completion callback once
      // the recording has finished processing — it's absent on the initial
      // call-attempt event and gets added when that event upgrades the row.
      recording_url: body.RecordingUrl || null,
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

// ── Stats + queue (dashboard reads — require login) ──────────────────────────
router.get('/stats', requireAuth, async (_req, res, next) => {
  try { res.json(await db.getDialerStats()); }
  catch (e) { next(e); }
});

router.get('/calls', requireAuth, async (req, res, next) => {
  try { res.json(await db.getCalls(req.query.limit || 200)); }
  catch (e) { next(e); }
});

router.get('/callbacks', requireAuth, async (_req, res, next) => {
  try { res.json(await db.getCallbackQueue()); }
  catch (e) { next(e); }
});

router.get('/recalls', requireAuth, async (_req, res, next) => {
  try { res.json(await db.getPendingRecalls()); }
  catch (e) { next(e); }
});

router.get('/followups', requireAuth, async (_req, res, next) => {
  try { res.json(await db.getPendingNoShows()); }
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
      RecordingUrl: d.RecordingUrl,
    };
    console.log(`[dialer] Exotel GET: ${d.CallType} from ${d.CallFrom || d.From}`);
    // Process every event — call-attempt logs the incoming call immediately
    // (essential on a trial account where the Connect leg never completes),
    // and a later completion event (same CallSid) upgrades that same row.
    await processCall(payload);
  } catch (e) {
    console.error('[dialer] GET call error:', e.message);
  }
});

// ── Shared call processor ─────────────────────────────────────────────────────
async function processCall(rawPayload) {
  const payload = normalisePayload(rawPayload);
  const { phone, caller_name, duration_sec, status, agent, ref_id, recording_url } = payload;

  if (!phone) {
    console.warn('[dialer] No phone number in payload:', rawPayload);
    return;
  }

  const normPhone = normalisePhone(phone);
  const finalStatus = (status || 'answered').toLowerCase();
  await db.tagLead({ phone: normPhone, name: caller_name || null, source: 'call', onlyIfNew: true }).catch(() => {});

  await db.logCall({
    phone:       normPhone,
    callerName:  caller_name  || null,
    durationSec: duration_sec || null,
    status:      finalStatus,
    agent:       agent  || null,
    notes:       ref_id ? `ref:${ref_id}` : null,
    refId:       ref_id || null,
    recordingUrl: recording_url || null,
  });

  if (finalStatus === 'received') {
    // Incoming call logged (e.g. trial account, Connect leg never completes).
    // Treat it like a missed call from the patient's perspective — send a
    // single "sorry we missed you, we'll call back" message and queue a
    // callback so staff can follow up. (Not onIncomingCall too — that would
    // be a second, redundant WhatsApp message for the same call.)
    await engagement.onMissedCall({ phone: normPhone, callerName: caller_name || null });
    console.log(`[dialer] Incoming call received from ${normPhone} (ref:${ref_id||'-'}) — callback queued`);
    return;
  }

  if (finalStatus === 'missed' || finalStatus === 'no-answer' || finalStatus === 'busy' || finalStatus === 'abandoned') {
    // Unanswered, or caller hung up before connecting — either way the patient
    // didn't get help, so apologise and queue a callback rather than treating
    // it as a completed call.
    await engagement.onMissedCall({ phone: normPhone, callerName: caller_name || null });
    console.log(`[dialer] Missed call from ${normPhone} — callback queued`);
  } else {
    // Answered & completed — send the post-call thank-you.
    await engagement.onCallCompleted({ phone: normPhone, callerName: caller_name || null });
    console.log(`[dialer] Answered call from ${normPhone} — thank-you sent`);
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

// ── Recording proxy (dashboard reads — require login) ────────────────────────
// Exotel's RecordingUrl is not publicly playable — it requires HTTP Basic Auth
// (API Key as username, API Token as password) per Exotel's own docs. A plain
// <audio src="..."> pointed straight at it makes the *browser* try to
// authenticate, which just pops a native sign-in dialog the user can't use.
// This route fetches the recording server-side (where the credentials live)
// and streams it back, forwarding Range headers both ways so seeking/scrubbing
// in the player still works.
router.get('/recording/:id', requireAuth, async (req, res, next) => {
  try {
    const call = await db.getCallById(req.params.id);
    if (!call || !call.recording_url) return res.sendStatus(404);

    const auth = Buffer.from(`${config.exotel.apiKey}:${config.exotel.apiToken}`).toString('base64');
    const headers = { Authorization: `Basic ${auth}` };
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await fetch(call.recording_url, { headers });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(502).json({ error: `Exotel returned ${upstream.status} fetching the recording` });
    }

    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) { next(e); }
});


router.post('/callback/:id/done', requireAuth, async (req, res, next) => {
  try {
    await db.markCallbackDone(req.params.id, req.body.status || 'called_back');
    res.json({ success: true });
  } catch (e) { next(e); }
});

// ── Manually log a call from the dashboard (requires login) ──────────────────
router.post('/call/manual', requireAuth, async (req, res, next) => {
  try {
    const { phone, caller_name, duration_sec, status } = req.body || {};
    if (!phone || !status) return res.status(400).json({ error: 'phone and status are required' });
    const id = await db.logCall({
      phone:       normalisePhone(phone),
      callerName:  caller_name || null,
      durationSec: duration_sec || null,
      status,
      agent:       req.actor || null,
      notes:       'manual entry',
      refId:       null,
    });
    res.json({ success: true, id });
  } catch (e) { next(e); }
});

// ── Mark a follow-up (no-show) as recovered (requires login) ─────────────────
router.post('/followup/:id/done', requireAuth, async (req, res, next) => {
  try {
    await db.markNoShowRecovered(req.params.id);
    res.json({ success: true });
  } catch (e) { next(e); }
});

module.exports = router;
