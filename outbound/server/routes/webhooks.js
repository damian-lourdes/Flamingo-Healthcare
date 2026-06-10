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

// ── Helpers ───────────────────────────────────────────────────────────────────
function ack(res) { res.sendStatus(200); }  // Always ack fast — MocDoc has short timeout

function normalisePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return phone.startsWith('+') ? phone : `+${digits}`;
}

// ── WhatsApp webhook verification ─────────────────────────────────────────────
router.get('/whatsapp', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    console.log('[webhook] WhatsApp verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── 1. Check In — patient arrives at hospital ─────────────────────────────────
// Trigger: Patient checks in for OP appointment
// Action:  Thank you for visiting message + upsert patient profile
router.post('/mocdoc/checkin', async (req, res) => {
  ack(res);
  try {
    const d = req.body;
    console.log('[webhook] check-in:', JSON.stringify(d));
    const phone     = normalisePhone(d.mobile || d.phone || d.patientmobile);
    const name      = d.patientname || d.name || d.patient_name || 'Patient';
    const doctor    = d.doctorname  || d.doctor || 'the doctor';
    const specialty = d.speciality  || d.specialty || '';
    const checkinKey = d.checkinkey || d.checkin_key || null;

    if (!phone) return;

    // Upsert patient
    await db.upsertPatient({ phone, name, specialty, doctor }).catch(() => {});

    // Send check-in acknowledgement
    await engagement.onConsultationStart({ phone, name, doctor, specialty, checkinKey });

    console.log(`[webhook] check-in processed: ${phone} — ${name}`);
  } catch (e) { console.error('[webhook] checkin error:', e.message); }
});

// ── 2. Check In Updation — check-in details updated ──────────────────────────
// Action: Update patient profile silently — no WhatsApp needed
router.post('/mocdoc/checkin-update', async (req, res) => {
  ack(res);
  try {
    const d = req.body;
    const phone  = normalisePhone(d.mobile || d.phone || d.patientmobile);
    const name   = d.patientname || d.name || null;
    const doctor = d.doctorname  || d.doctor || null;
    if (phone) await db.upsertPatient({ phone, name, doctor }).catch(() => {});
    console.log(`[webhook] checkin-update: ${phone}`);
  } catch (e) { console.error('[webhook] checkin-update error:', e.message); }
});

// ── 3. Check Out — consultation completed ────────────────────────────────────
// Trigger: Doctor marks patient as checked out / consultation done
// Action:  Post-consultation thank you + review request
router.post('/mocdoc/checkout', async (req, res) => {
  ack(res);
  try {
    const d = req.body;
    console.log('[webhook] checkout:', JSON.stringify(d));
    const phone      = normalisePhone(d.mobile || d.phone || d.patientmobile);
    const name       = d.patientname  || d.name || 'Patient';
    const doctor     = d.doctorname   || d.doctor || 'the doctor';
    const specialty  = d.speciality   || d.specialty || '';
    const followUpDate = d.followupdate || d.follow_up_date || null;
    const visitKey   = d.visitkey     || d.visit_key || d.checkinkey || null;

    if (!phone) return;

    await db.upsertPatient({ phone, name, specialty, doctor }).catch(() => {});
    await engagement.onConsultationComplete({ phone, name, doctor, specialty, followUpDate, visitKey });

    // Schedule recall if specialty known
    if (specialty) {
      await db.scheduleRecall({ phone, name, specialty, days: 30 }).catch(() => {});
    }

    console.log(`[webhook] checkout processed: ${phone} — ${name}`);
  } catch (e) { console.error('[webhook] checkout error:', e.message); }
});

// ── 4. OP Bill Creation — bill raised after consultation ─────────────────────
// Trigger: Receptionist creates OP bill
// Action:  Log bill event, send payment confirmation if needed
router.post('/mocdoc/op-bill', async (req, res) => {
  ack(res);
  try {
    const d = req.body;
    console.log('[webhook] op-bill:', JSON.stringify(d));
    const phone    = normalisePhone(d.mobile || d.phone || d.patientmobile);
    const name     = d.patientname || d.name || 'Patient';
    const doctor   = d.doctorname  || d.consultant || 'the doctor';
    const billNo   = d.billnumber  || d.bill_no || d.billno || '';
    const amount   = d.totalamount || d.amount || d.totalamt || '';
    const billKey  = d.billkey     || null;

    if (!phone) return;

    await db.upsertPatient({ phone, name }).catch(() => {});
    await engagement.onBillCreated({ phone, name, doctor, billNo, amount, billKey });

    console.log(`[webhook] op-bill processed: ${phone} bill ${billNo}`);
  } catch (e) { console.error('[webhook] op-bill error:', e.message); }
});

// ── 5. OP Bill Updation — bill edited ────────────────────────────────────────
// Action: Log silently — no WhatsApp for bill edits
router.post('/mocdoc/op-bill-update', async (req, res) => {
  ack(res);
  try {
    const d = req.body;
    console.log(`[webhook] op-bill-update: bill ${d.billnumber || d.billkey}`);
  } catch (e) { console.error('[webhook] op-bill-update error:', e.message); }
});

// ── 6. OP Bill Cancellation ───────────────────────────────────────────────────
// Trigger: Bill cancelled in MocDoc
// Action:  Send cancellation confirmation to patient
router.post('/mocdoc/op-bill-cancel', async (req, res) => {
  ack(res);
  try {
    const d = req.body;
    console.log('[webhook] op-bill-cancel:', JSON.stringify(d));
    const phone    = normalisePhone(d.mobile || d.phone || d.patientmobile);
    const name     = d.patientname  || d.name || 'Patient';
    const billNo   = d.billnumber   || d.bill_no || '';
    const reason   = d.cancelreason || d.cancel_reason || '';

    if (!phone) return;
    await engagement.onBillCancelled({ phone, name, billNo, reason });

    console.log(`[webhook] op-bill-cancel processed: ${phone} bill ${billNo}`);
  } catch (e) { console.error('[webhook] op-bill-cancel error:', e.message); }
});

// ── 7. Appointment Confirmation ───────────────────────────────────────────────
// Trigger: Appointment confirmed in MocDoc
// Action:  Send appointment confirmation WhatsApp (replaces polling)
router.post('/mocdoc/appt-confirm', async (req, res) => {
  ack(res);
  try {
    const d = req.body;
    console.log('[webhook] appt-confirm:', JSON.stringify(d));
    const phone    = normalisePhone(d.mobile || d.phone || d.patientmobile);
    const name     = d.patientname  || d.name || d.fname || 'Patient';
    const doctor   = d.doctorname   || d.doctor || 'the doctor';
    const specialty = d.speciality  || d.specialty || '';
    const datetime = d.apptdatetime || d.appointmentdatetime || d.date || '';
    const apptKey  = d.apptkey      || d.appointment_key || null;

    if (!phone) return;

    await db.upsertPatient({ phone, name, specialty, doctor }).catch(() => {});
    await engagement.onAppointmentBooked({ phone, name, doctor, specialty, datetime, apptKey });

    console.log(`[webhook] appt-confirm processed: ${phone} — ${datetime}`);
  } catch (e) { console.error('[webhook] appt-confirm error:', e.message); }
});

// ── 8. Appointment Reschedule ─────────────────────────────────────────────────
// Trigger: Appointment rescheduled in MocDoc
// Action:  Send new confirmation with updated date/time
router.post('/mocdoc/appt-reschedule', async (req, res) => {
  ack(res);
  try {
    const d = req.body;
    console.log('[webhook] appt-reschedule:', JSON.stringify(d));
    const phone    = normalisePhone(d.mobile || d.phone || d.patientmobile);
    const name     = d.patientname  || d.name || d.fname || 'Patient';
    const doctor   = d.doctorname   || d.doctor || 'the doctor';
    const specialty = d.speciality  || d.specialty || '';
    const newDate  = d.newdatetime  || d.new_datetime || d.apptdatetime || '';
    const apptKey  = d.apptkey      || null;

    if (!phone) return;

    await engagement.onAppointmentRescheduled({ phone, name, doctor, specialty, newDate, apptKey });

    console.log(`[webhook] appt-reschedule processed: ${phone} → ${newDate}`);
  } catch (e) { console.error('[webhook] appt-reschedule error:', e.message); }
});

// ── 9. Appointment Cancellation ───────────────────────────────────────────────
// Trigger: Appointment cancelled in MocDoc
// Action:  Send cancellation notice + re-booking link
router.post('/mocdoc/appt-cancel', async (req, res) => {
  ack(res);
  try {
    const d = req.body;
    console.log('[webhook] appt-cancel:', JSON.stringify(d));
    const phone    = normalisePhone(d.mobile || d.phone || d.patientmobile);
    const name     = d.patientname  || d.name || d.fname || 'Patient';
    const doctor   = d.doctorname   || d.doctor || '';
    const reason   = d.cancelreason || d.cancel_reason || '';
    const apptKey  = d.apptkey      || null;

    if (!phone) return;

    await engagement.onAppointmentCancelled({ phone, name, doctor, reason, apptKey });

    console.log(`[webhook] appt-cancel processed: ${phone}`);
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

module.exports = router;
