/* server/routes/webhooks.js
 * MocDoc Webhook receivers — all 10 available webhooks fully integrated.
 * Register each URL in MocDoc admin → Settings → Webhooks.
 *
 * Webhook URLs to register in MocDoc:
 *   Check In:                 POST /hooks/mocdoc/checkin
 *   Check In Updation:        POST /hooks/mocdoc/checkin-update
 *   Check Out:                POST /hooks/mocdoc/checkout
 *   OP Bill Creation:         POST /hooks/mocdoc/op-bill
 *   OP Bill Updation:         POST /hooks/mocdoc/op-bill-update
 *   OP Bill Cancellation:     POST /hooks/mocdoc/op-bill-cancel
 *   Appointment Confirmation: POST /hooks/mocdoc/appt-confirm
 *   Appointment Reschedule:   POST /hooks/mocdoc/appt-reschedule
 *   Appointment Cancellation: POST /hooks/mocdoc/appt-cancel
 *
 * WhatsApp verification:      GET  /hooks/whatsapp
 *
 * Still polled (no webhook available):
 *   IP Admissions, IP Discharges, Lab Orders, Lab Results, Patient Registration
 */

const router     = require('express').Router();
const sync       = require('../services/mocdoc-sync');
const engagement = require('../services/engagement');
const db         = require('../services/db');
const config     = require('../config');

// ── Webhook rate limiting middleware ──────────────────────────────────────────
// Protects against misconfigured PBX flooding and malicious requests
function rateLimitWebhook(maxPerMinute = 60) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!db.checkWebhookRateLimit(ip, maxPerMinute)) {
      console.warn(`[webhook] rate limit exceeded for IP ${ip}`);
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}

// Apply rate limiting to all webhook routes
router.use(rateLimitWebhook(120)); // 120 requests/min per IP

// ── Helpers ───────────────────────────────────────────────────────────────────
function ack(res) { res.sendStatus(200); }  // Always ack fast — MocDoc has short timeout

function normalisePhone(phone, isdCode) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  const isd    = String(isdCode || '91').replace(/\D/g, '') || '91';
  if (digits.length === 10) return `+${isd}${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith('091')) return `+${digits.slice(1)}`;
  return String(phone).startsWith('+') ? phone : `+${digits}`;
}

// ── Meta WhatsApp delivery status webhook ─────────────────────────────────────
// Meta POSTs here for every message: sent → delivered → read (or failed)
// Register this URL in Meta Business Manager → WhatsApp → Configuration
router.post('/whatsapp', async (req, res) => {
  res.sendStatus(200); // Always ack immediately
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const val = change.value || {};

        // ── Delivery status updates ──────────────────────────────────────────
        for (const status of val.statuses || []) {
          const waMessageId = status.id;
          const phone       = `+${status.recipient_id}`;
          const st          = status.status;             // sent|delivered|read|failed
          const errorCode   = status.errors?.[0]?.code?.toString() || null;
          const errorMsg    = status.errors?.[0]?.message || null;

          await db.updateDeliveryStatus({ waMessageId, phone, status: st, errorCode, errorMsg });

          if (st === 'failed') {
            console.error(`[wa-delivery] FAILED ${phone} msg:${waMessageId} err:${errorCode} ${errorMsg}`);
          } else {
            console.log(`[wa-delivery] ${st} → ${phone}`);
          }
        }

        // ── Inbound messages — opt-out handling ──────────────────────────────
        for (const msg of val.messages || []) {
          const phone = `+${msg.from}`;
          const text  = (msg.text?.body || '').trim().toUpperCase();

          // STOP / UNSUBSCRIBE → set opt_in = false
          if (['STOP', 'UNSUBSCRIBE', 'OPT OUT', 'OPTOUT'].includes(text)) {
            await db.pool?.query(
              'UPDATE patient_profiles SET opt_in=FALSE WHERE phone=$1', [phone]
            ).catch(() => {});
            console.log(`[wa-inbound] opt-out: ${phone}`);
          }

          // START / YES → re-enable opt_in
          if (['START', 'SUBSCRIBE', 'YES'].includes(text)) {
            await db.pool?.query(
              'UPDATE patient_profiles SET opt_in=TRUE WHERE phone=$1', [phone]
            ).catch(() => {});
            console.log(`[wa-inbound] opt-in: ${phone}`);
          }
        }
      }
    }
  } catch (e) { console.error('[wa-webhook] error:', e.message); }
});

// ── WhatsApp webhook verification ─────────────────────────────────────────────
router.get('/whatsapp', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    console.log('[webhook] WhatsApp verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── 0. Registration — new patient registered in MocDoc ──────────────────────────
// Trigger: Patient registered for the first time
// Payload: name, lname, phid, mobile, gender, dob
// Action:  Welcome / enquiry message
router.post('/mocdoc/registration', async (req, res) => {
  ack(res);
  try {
    const d = req.body;
    console.log('[webhook] registration:', JSON.stringify(d));

    const phone     = normalisePhone(d.mobile || d.phone);
    const altPhone  = normalisePhone(d.contactnumbers);
    const firstName = d.name  || '';
    const lastName  = d.lname || '';
    const name      = [firstName, lastName].filter(Boolean).join(' ') || 'Patient';
    const phid      = d.phid  || d.extphid || null;
    const dob       = parseDob(d.dob);
    const email     = d.email || null;
    const gender    = d.gender || null;
    const bloodGroup = d.bloodgroup || null;
    const title     = d.title || null;

    if (!phone) {
      console.warn('[webhook] registration: no mobile number in payload');
      return;
    }

    // Upsert patient with full demographic data
    // DOB is saved so birthday automation fires automatically each year
    await db.upsertPatient({
      phone,
      name,
      dob,
      ref_id: phid,
    }).catch(() => {});

    // Send welcome / enquiry message
    await engagement.onEnquiry({ phone, name });

    console.log(`[webhook] registration: ${name} (${phid}) ${phone}${dob ? ' DOB:'+dob : ''}`);
  } catch (e) { console.error('[webhook] registration error:', e.message); }
});

// ── 1. Check In — patient arrives at hospital ─────────────────────────────────
// Trigger: Patient checks in for OP appointment
// Full payload includes nested patient object with complete demographics
router.post('/mocdoc/checkin', async (req, res) => {
  ack(res);
  try {
    const d = req.body;

    // ── Extract patient from nested object (MocDoc sends patient as object) ──
    const pt = d.patient || {};

    // Phone — prefer patient.mobile, fallback to top-level
    const rawPhone = pt.mobile || d.mobile || d.patientmobile || d.phone;
    const isdCode  = pt.isdcode || d.isdcode || '91';
    const phone    = normalisePhone(rawPhone, isdCode);

    if (!phone) {
      console.warn('[webhook] checkin: no mobile number');
      return;
    }

    // Patient demographics
    const firstName = pt.name   || d.patientname || d.name || '';
    const lastName  = pt.lname  || '';
    const name      = [firstName, lastName].filter(Boolean).join(' ') || 'Patient';
    const phid      = pt.phid   || d.phid || null;
    const dob       = parseDob(pt.dob || d.dob);

    // Visit details
    const doctor    = d.consultingdr_name || d.bookeddr_name || d.doctorname || 'the doctor';
    const specialty = d.speciality || d.specialty || d.purpose || '';
    const opno      = d.opno      || null;
    const token     = d.token     || null;
    const location  = d.entitylocation || null;
    const checkinKey = d.checkinkey || d.checkin_key || opno || null;

    // Upsert full patient profile — captures DOB for birthday automation
    await db.upsertPatient({
      phone, name, dob, specialty, doctor,
      ref_id: phid,
    }).catch(() => {});

    // Send check-in acknowledgement
    await engagement.onConsultationStart({ phone, name, doctor, specialty, checkinKey, token });

    console.log(`[webhook] check-in: ${name} (${phid}) OP#${opno} Token:${token} Dr:${doctor}`);
  } catch (e) { console.error('[webhook] checkin error:', e.message); }
});

// ── 2. Check In Updation — check-in details updated ──────────────────────────
// Same payload structure as Check In — nested patient object
// Action: Silently update patient profile with latest demographics
// No WhatsApp sent — patient already received check-in message
router.post('/mocdoc/checkin-update', async (req, res) => {
  ack(res);
  try {
    const d  = req.body;
    const pt = d.patient || {};

    const rawPhone = pt.mobile || d.mobile || d.patientmobile || d.phone;
    const isdCode  = pt.isdcode || d.isdcode || '91';
    const phone    = normalisePhone(rawPhone, isdCode);

    if (!phone) return;

    const firstName = pt.name  || d.patientname || d.name || '';
    const lastName  = pt.lname || '';
    const name      = [firstName, lastName].filter(Boolean).join(' ') || null;
    const phid      = pt.phid  || d.phid || null;
    const dob       = parseDob(pt.dob || d.dob);
    const doctor    = d.consultingdr_name || d.bookeddr_name || d.doctorname || null;
    const specialty = d.speciality || d.specialty || d.purpose || null;

    // Update patient profile with latest data — especially DOB if not yet captured
    await db.upsertPatient({ phone, name, dob, specialty, doctor, ref_id: phid }).catch(() => {});

    console.log(`[webhook] checkin-update: ${name} (${phid}) ${phone} Dr:${doctor}`);
  } catch (e) { console.error('[webhook] checkin-update error:', e.message); }
});

// ── 3. Check Out — consultation completed ────────────────────────────────────
// Trigger: Receptionist marks patient as checked out after consultation
// Key fields: co_user_dt (checkout time), consultingdr_name, nested patient object
// Action:  Post-consultation thank you + review request + schedule 30-day recall
router.post('/mocdoc/checkout', async (req, res) => {
  ack(res);
  try {
    const d  = req.body;
    const pt = d.patient || {};

    const rawPhone = pt.mobile || d.mobile || d.patientmobile || d.phone;
    const isdCode  = pt.isdcode || d.isdcode || '91';
    const phone    = normalisePhone(rawPhone, isdCode);

    if (!phone) return;

    const firstName  = pt.name  || d.patientname || d.name || '';
    const lastName   = pt.lname || '';
    const name       = [firstName, lastName].filter(Boolean).join(' ') || 'Patient';
    const phid       = pt.phid  || d.phid || null;
    const dob        = parseDob(pt.dob || d.dob);

    // Use consulting doctor (actual) over booked doctor
    const doctor     = d.consultingdr_name || d.bookeddr_name || d.doctorname || 'the doctor';
    const specialty  = d.speciality || d.specialty || d.purpose || '';
    const opno       = d.opno || null;
    const checkoutDt = d.co_user_dt || null;  // YYYYMMDDHH:MM:SS — actual checkout time
    const followUpDate = d.followupdate || d.follow_up_date || null;
    const visitKey   = opno || d.visitkey || d.checkinkey || null;

    // Update patient profile with latest data
    await db.upsertPatient({ phone, name, dob, specialty, doctor, ref_id: phid }).catch(() => {});

    // Post-consultation thank you + review request
    await engagement.onConsultationComplete({
      phone, name, doctor, specialty, followUpDate, visitKey,
    });

    // Schedule 30-day recall automatically on checkout
    if (specialty) {
      await db.scheduleRecall({ phone, name, specialty, days: 30 }).catch(() => {});
    }

    console.log(`[webhook] checkout: ${name} (${phid}) OP#${opno} Dr:${doctor} at ${checkoutDt}`);
  } catch (e) { console.error('[webhook] checkout error:', e.message); }
});

// ── 4. OP Bill Creation — bill raised after consultation ─────────────────────
// Trigger: Receptionist creates OP bill in MocDoc
// Key fields: bill_no, amountpayable, amountreceived, paymenttype, consultant
// Note: This payload does NOT include patient object — patient is identified
// via the session context. Phone must come from the check-in patient profile.
// Action: Send bill confirmation with amount and payment details
router.post('/mocdoc/op-bill', async (req, res) => {
  ack(res);
  try {
    const d = req.body;

    // OP Bill payload has no nested patient object — phone may not be present
    // Best effort: extract from any available field
    const phone   = normalisePhone(
      d.mobile || d.patientmobile || d.phone || d.patient_mobile
    );
    const name    = d.patientname || d.patient_name || d.name || 'Patient';
    const doctor  = d.consultant  || d.consultingdr_name || d.doctorname || 'the doctor';

    // Bill details
    const billNo      = d['bill no'] || d.billno || d.bill_no || d.billnumber || '';
    const billDate    = d.billdate   || d.saved_at || null;
    const amountPay   = d.amountpayable  || d.totalamount || d.amount || '';
    const amountRec   = d.amountreceived || '';
    const paymentType = d.paymenttype || '';
    const discount    = d.discountamount || 0;
    const consultant  = d.consultant || doctor;
    const billKey     = d.billkey || billNo || null;
    const location    = d.location || '';

    // Build bill summary from items array
    const items = d.billitems || {};
    const itemList = Object.values(items)
      .filter(i => i && i.label)
      .map(i => `• ${i.label}${i.qty > 1 ? ` ×${i.qty}` : ''} — ₹${i.price}`)
      .slice(0, 5); // max 5 items in WhatsApp

    if (!phone) {
      // No phone in payload — log and skip WhatsApp
      console.log(`[webhook] op-bill: no phone — bill ${billNo} ₹${amountPay} by ${consultant}`);
      return;
    }

    await db.upsertPatient({ phone, name }).catch(() => {});
    await engagement.onBillCreated({
      phone, name, doctor: consultant, billNo, amount: amountPay,
      amountReceived: amountRec, paymentType, discount, itemList, billKey,
    });

    console.log(`[webhook] op-bill: ${name} bill ${billNo} ₹${amountPay} (${paymentType})`);
  } catch (e) { console.error('[webhook] op-bill error:', e.message); }
});

// ── 5. OP Bill Updation — bill edited ────────────────────────────────────────
// Payload: updated_by, updated_at, bill_no, amountpayable, billitems
// No patient phone in payload — cannot send WhatsApp
// Action: Log the update for audit trail only
router.post('/mocdoc/op-bill-update', async (req, res) => {
  ack(res);
  try {
    const d = req.body;
    const billNo     = d['bill no'] || d.billno || d.bill_no || d.billnumber || '';
    const updatedBy  = d.updated_by || d.saved_by || '';
    const updatedAt  = d.updated_at || d.saved_at || '';
    const amountPay  = d.amountpayable  || '';
    const amountRec  = d.amountreceived || '';
    const consultant = d.consultant || '';

    // Count bill items
    const items      = d.billitems || {};
    const itemCount  = Object.values(items).filter(i => i && i.label).length;

    console.log(`[webhook] op-bill-update: bill ${billNo} ₹${amountPay} by ${updatedBy} at ${updatedAt} (${itemCount} items, consultant: ${consultant})`);
    // No WhatsApp sent — bill edits are internal operations
    // Patient already received bill confirmation on creation
  } catch (e) { console.error('[webhook] op-bill-update error:', e.message); }
});

// ── 6. OP Bill Cancellation ───────────────────────────────────────────────────
// Payload: cancelled_by, cancelled_reason, bill_no, amountpayable, billitems
// No patient phone in payload — cannot send WhatsApp directly
// Action: Log cancellation for audit; send WhatsApp only if phone is available
router.post('/mocdoc/op-bill-cancel', async (req, res) => {
  ack(res);
  try {
    const d = req.body;

    const billNo       = d['bill no']        || d.billno || d.bill_no || d.billnumber || '';
    const reason       = d.cancelled_reason  || d.cancelreason || d.cancel_reason || '';
    const cancelledBy  = d.cancelled_by      || d.saved_by || '';
    const amountPay    = d.amountpayable     || '';
    const amountRec    = d.amountreceived    || '';
    const consultant   = d.consultant        || '';
    const billDate     = d.billdate          || d.saved_at || '';

    // Count bill items for logging
    const items     = d.billitems || {};
    const itemNames = Object.values(items)
      .filter(i => i && i.label)
      .map(i => i.label)
      .join(', ');

    console.log(`[webhook] op-bill-cancel: bill ${billNo} ₹${amountPay} by ${cancelledBy}${reason ? ' reason: '+reason : ''} (${itemNames})`);

    // Phone not in payload — attempt from any fallback field
    const phone = normalisePhone(d.mobile || d.patientmobile || d.phone);
    const name  = d.patientname || d.patient_name || d.name || 'Patient';

    if (phone) {
      await engagement.onBillCancelled({ phone, name, billNo, reason, amountPay, cancelledBy });
    } else {
      console.log(`[webhook] op-bill-cancel: no phone in payload — WhatsApp skipped for bill ${billNo}`);
    }
  } catch (e) { console.error('[webhook] op-bill-cancel error:', e.message); }
});

// ── 7. Appointment Confirmation ───────────────────────────────────────────────
// Trigger: Appointment confirmed in MocDoc
// Payload: phone + isdcode at top level (no nested patient object)
// Key fields: fname, phone, isdcode, date, start, end, dr name, purpose, bookingmode
router.post('/mocdoc/appt-confirm', async (req, res) => {
  ack(res);
  try {
    const d = req.body;

    // Phone is top-level with isdcode
    const phone   = normalisePhone(d.phone || d.mobile, d.isdcode || '91');
    const altPhone = normalisePhone(d.altphone, d.altisdcode || '91');

    if (!phone) {
      console.warn('[webhook] appt-confirm: no phone');
      return;
    }

    const name      = d.fname       || d.patientname || d.name || 'Patient';
    const title     = d.title       || '';
    const fullName  = [title, name].filter(Boolean).join(' ');

    // Doctor details
    const doctor    = d['dr name']  || d.bookedby || d.doctorname || 'the doctor';
    const specialty = d.purpose     || d.speciality || d.specialty || '';
    const location  = d['dr location'] || '';

    // Appointment timing
    const apptDate  = d.date        || '';   // YYYYMMDD
    const startTime = d.start       || '';   // HH:MM
    const endTime   = d.end         || '';   // HH:MM
    const datetime  = apptDate && startTime
      ? `${formatDate(apptDate)}, ${startTime}${endTime ? ' – '+endTime : ''}`
      : apptDate || startTime || '';

    const bookingMode = d.bookingmode || '';  // FrontOffice-Call, Online, etc.
    const notes       = d.appnotes   || '';
    const apptKey     = d.apptkey    || `${d.phone}_${apptDate}_${startTime}` || null;

    // Upsert patient profile
    await db.upsertPatient({ phone, name: fullName, specialty, doctor }).catch(() => {});

    // Send appointment confirmation
    await engagement.onAppointmentBooked({
      phone, name: fullName, doctor, specialty, datetime, apptKey, notes,
    });

    console.log(`[webhook] appt-confirm: ${fullName} ${phone} Dr:${doctor} ${datetime} (${bookingMode})`);
  } catch (e) { console.error('[webhook] appt-confirm error:', e.message); }
});

// ── 8. Appointment Reschedule ─────────────────────────────────────────────────
// Trigger: Appointment rescheduled in MocDoc
// Same structure as Appointment Confirmation + rescheduled_by, rescheduled_at, oldstart
// Action: Send updated confirmation with new time and old time for clarity
router.post('/mocdoc/appt-reschedule', async (req, res) => {
  ack(res);
  try {
    const d = req.body;

    const phone   = normalisePhone(d.phone || d.mobile, d.isdcode || '91');
    if (!phone) {
      console.warn('[webhook] appt-reschedule: no phone');
      return;
    }

    const name    = d.fname || d.patientname || d.name || 'Patient';
    const title   = d.title || '';
    const fullName = [title, name].filter(Boolean).join(' ');

    const doctor   = d['dr name'] || d.bookedby || d.doctorname || 'the doctor';
    const specialty = d.purpose   || d.speciality || d.specialty || '';

    // New appointment timing
    const apptDate  = d.date   || '';
    const startTime = d.start  || '';
    const endTime   = d.end    || '';
    const newDate   = apptDate && startTime
      ? `${formatDate(apptDate)}, ${startTime}${endTime ? ' – '+endTime : ''}`
      : apptDate || startTime || '';

    // Old time for reference
    const oldStart  = d.oldstart || '';
    const oldDate   = oldStart ? `${formatDate(apptDate)}, ${oldStart}` : '';

    const rescheduledBy = d.rescheduled_by || '';
    const rescheduledAt = d.rescheduled_at || '';
    const notes     = d.appnotes || '';
    const apptKey   = d.apptkey || `${d.phone}_${apptDate}_${startTime}` || null;

    await db.upsertPatient({ phone, name: fullName, specialty, doctor }).catch(() => {});
    await engagement.onAppointmentRescheduled({
      phone, name: fullName, doctor, specialty,
      newDate, oldDate, apptKey, notes,
    });

    console.log(`[webhook] appt-reschedule: ${fullName} ${phone} Dr:${doctor} ${oldDate || '?'} → ${newDate} by ${rescheduledBy}`);
  } catch (e) { console.error('[webhook] appt-reschedule error:', e.message); }
});

// ── 9. Appointment Cancellation ───────────────────────────────────────────────
// Trigger: Appointment cancelled in MocDoc
// Same structure as Confirmation + cancelled array (date, person, cancelledby, reason)
// person field: "Doctor" = doctor cancelled, "Patient" = patient cancelled
// Action: Send cancellation notice with reason + re-booking link
router.post('/mocdoc/appt-cancel', async (req, res) => {
  ack(res);
  try {
    const d = req.body;

    const phone   = normalisePhone(d.phone || d.mobile, d.isdcode || '91');
    if (!phone) {
      console.warn('[webhook] appt-cancel: no phone');
      return;
    }

    const name     = d.fname || d.patientname || d.name || 'Patient';
    const title    = d.title || '';
    const fullName = [title, name].filter(Boolean).join(' ');
    const doctor   = d['dr name'] || d.bookedby || d.doctorname || 'the doctor';
    const specialty = d.purpose   || d.speciality || d.specialty || '';

    // Cancelled array contains cancellation details
    const cancelInfo   = Array.isArray(d.cancelled) ? d.cancelled[0] : (d.cancelled || {});
    const reason       = cancelInfo.reason      || d.reason || d.cancelreason || '';
    const cancelledBy  = cancelInfo.cancelledby || d.cancelledby || '';
    const cancelPerson = cancelInfo.person       || '';  // "Doctor" or "Patient"
    const cancelDate   = cancelInfo.date         || '';

    // Appointment details (for context in message)
    const apptDate  = d.date  || '';
    const startTime = d.start || '';
    const endTime   = d.end   || '';
    const datetime  = apptDate && startTime
      ? `${formatDate(apptDate)}, ${startTime}${endTime ? ' – '+endTime : ''}`
      : apptDate || startTime || '';

    const apptKey  = d.apptkey || `${d.phone}_${apptDate}_${startTime}` || null;

    await engagement.onAppointmentCancelled({
      phone, name: fullName, doctor, specialty,
      datetime, reason, cancelPerson, apptKey,
    });

    console.log(`[webhook] appt-cancel: ${fullName} ${phone} Dr:${doctor} ${datetime} by ${cancelPerson}${reason ? ' — '+reason : ''}`);
  } catch (e) { console.error('[webhook] appt-cancel error:', e.message); }
});

// ── Legacy catch-all (for backward compat if MocDoc sends to /hooks/mocdoc) ──
router.post('/mocdoc', async (req, res) => {
  ack(res);
  const { event, data } = req.body;
  if (!event || !data) return;
  try { await sync.handleWebhook(event, data); }
  catch (e) { console.error('[mocdoc-webhook]', e.message); }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseDob(dob) {
  // MocDoc DOB format: YYYYMMDD → convert to YYYY-MM-DD for PostgreSQL
  if (!dob) return null;
  const s = String(dob).replace(/\D/g, '');
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return null;
}

function formatDate(d) {
  // Convert YYYYMMDD to readable: 09 Dec 2021
  if (!d) return '';
  const s = String(d).replace(/\D/g, '');
  if (s.length < 8) return d;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const year = s.slice(0,4), month = parseInt(s.slice(4,6))-1, day = s.slice(6,8);
  return `${day} ${months[month] || ''} ${year}`;
}


// ── TEST ENDPOINT — bypasses dedup, sends WhatsApp directly ──────────────────
// Remove this in production
router.post('/test-whatsapp', async (req, res) => {
  res.sendStatus(200);
  const { phone, message } = req.body;
  if (!phone || !message) {
    console.log('[test] missing phone or message');
    return;
  }
  const to = normalisePhone(phone, '91');
  console.log(`[test] sending directly to ${to}`);
  try {
    const wa = require('../services/whatsapp');
    const d = await wa.sendText(to, message);
    console.log('[test] Meta response:', JSON.stringify(d));
  } catch (e) {
    console.error('[test] error:', e.message);
  }
});

module.exports = router;
