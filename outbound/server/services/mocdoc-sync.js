/* MocDoc → Flamingo Engagement Sync Worker
 * Polls MocDoc APIs every 60 seconds and fires engagement triggers.
 * Covers all available APIs — webhook-ready architecture so swap is trivial later.
 *
 * Polling map:
 *   GET /api/get/opvisits        → appointment confirmed / completed / no-show
 *   GET /api/get/ptlist          → new patient registration
 *   GET /api/get/ipadmissions    → IP admission (attender message)
 *   GET /api/get/ipdischarges    → IP discharge + schedule 3-day check
 *   GET /api/lims/labresults     → lab report ready
 *   GET /api/lims/laborders      → new lab order (prep instructions)
 *   GET /api/mis/bills           → OP bill generated (post-consultation trigger)
 */
const mocdoc     = require('./mocdoc');
const engagement = require('./engagement');
const db         = require('./db');

// In-memory dedup — prevents re-processing same record in same session
// On restart the DB engagement_log handles cross-session dedup
const seen = {
  visits:        new Set(),
  patients:      new Set(),
  admissions:    new Set(),
  discharges:    new Set(),
  labOrders:     new Set(),
  labResults:    new Set(),
  bills:         new Set(),
  roomTransfers: new Set(),
};

// ── Phone normalisation ───────────────────────────────────────────────────────
function normalisePhone(raw) {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, '');
  if (d.length === 10)                          return `+91${d}`;
  if (d.length === 12 && d.startsWith('91'))    return `+${d}`;
  if (d.length === 13 && d.startsWith('091'))   return `+${d.slice(1)}`;
  return d.length > 6 ? `+${d}` : null;
}

// ── 1. OP VISITS — confirmed / completed / no-show ────────────────────────────
async function syncOPVisits(date) {
  const data   = await mocdoc.getOPVisits(date);
  const visits = data?.visits || data?.opvisits || data?.data || [];
  if (!visits.length) return;

  for (const v of visits) {
    const id     = String(v.apt_id || v.id || '');
    const phone  = normalisePhone(v.mobile || v.patient_mobile || v.ph_mobile);
    const name   = v.patient_name || v.name || 'Patient';
    const doctor = v.doctor_name  || v.dr_name || v.doctor || '';
    const spec   = v.specialty    || v.department || v.dept || '';
    const status = (v.status || v.apt_status || '').toString().toUpperCase();
    const dt     = `${v.apt_date || date} ${v.apt_time || v.time || ''}`.trim();

    if (!phone || !id) continue;

    // Confirmed → send booking confirmation + schedule 30-day recall
    if (!seen.visits.has(`b_${id}`) && ['A','B','1','CONFIRMED','BOOKED'].includes(status)) {
      seen.visits.add(`b_${id}`);
      await engagement.onAppointmentBooked({ phone, name, doctor, specialty: spec, datetime: dt });
      await db.scheduleRecall({ phone, name, specialty: spec, daysFromNow: 30 }).catch(() => {});
    }

    // Completed → post-consultation message
    if (!seen.visits.has(`co_${id}`) && ['CO','COMPLETED','3'].includes(status)) {
      seen.visits.add(`co_${id}`);
      await engagement.onConsultationComplete({
        phone, name, doctor, specialty: spec,
        followUpDate: v.followup_date || v.next_visit || null,
      });
    }

    // No-show → add to follow-up queue for recovery
    if (!seen.visits.has(`ns_${id}`) && ['NS','NO-SHOW','NO_SHOW','4'].includes(status)) {
      seen.visits.add(`ns_${id}`);
      await db.addNoShow({ phone, name, doctor, specialty: spec, originalDt: dt });
      console.log(`[sync] No-show queued: ${name} (${phone})`);
    }
  }
}

// ── 2. PATIENT REGISTRATION — welcome message ─────────────────────────────────
async function syncNewPatients(date) {
  const data     = await mocdoc.getPatientsByDate(date);
  const patients = data?.patients || data?.data || [];
  if (!patients.length) return;

  for (const p of patients) {
    const id    = String(p.phid || p.patient_id || p.id || '');
    const phone = normalisePhone(p.mobile || p.ph_mobile || p.patient_mobile);
    const name  = p.patient_name || p.name || '';

    if (!phone || !id || seen.patients.has(id)) continue;
    seen.patients.add(id);

    // Only send if truly new (registered today)
    const regDate = (p.created_at || p.reg_date || '').toString().substring(0, 10);
    const isNew   = !regDate || regDate.includes(new Date().getFullYear());
    if (!isNew) continue;

    await engagement.onEnquiry({ phone, name });
    console.log(`[sync] Welcome sent to new patient: ${name} (${phone})`);
  }
}

// ── 3. IP ADMISSIONS — attender message ───────────────────────────────────────
async function syncIPAdmissions(date) {
  const data       = await mocdoc.getIPAdmissions(date);
  const admissions = data?.admissions || data?.ipadmissions || data?.data || [];
  if (!admissions.length) return;

  for (const a of admissions) {
    const id       = String(a.ip_id || a.admission_id || a.id || '');
    const phone    = normalisePhone(a.mobile || a.patient_mobile);
    const attender = normalisePhone(a.attender_mobile || a.attender_phone || a.relative_mobile);
    const name     = a.patient_name || a.name || 'Patient';
    const ward     = a.ward || a.room || a.ward_name || 'General Ward';
    const doctor   = a.doctor_name || a.dr_name || a.doctor || '';

    if (!id || seen.admissions.has(id)) continue;
    seen.admissions.add(id);

    // Message attender with ward info
    const targetPhone = attender || phone;
    if (targetPhone) {
      await engagement.onIPAdmission({
        attenderPhone: targetPhone,
        patientName: name,
        ward, doctor,
        admissionId: id,
      });
    }

    // Schedule Day 2 feedback (~24h from now) — stored durably so a server
    // restart between now and the due time doesn't silently drop it (a
    // setTimeout() here would be lost on restart with no record it was owed).
    const admitTime = new Date(a.admitted_at || a.admission_date || Date.now());
    const day2DueAt = new Date(admitTime.getTime() + 24 * 60 * 60 * 1000);
    if (targetPhone) {
      await db.scheduleDelayedMessage({
        messageType: 'ip_day2',
        phone: targetPhone,
        payload: { attenderPhone: targetPhone, patientName: name, admissionId: id },
        dueAt: day2DueAt,
      });
    }
  }
}

// ── 4. IP DISCHARGES — care instructions + schedule 3-day check ───────────────
async function syncIPDischarges(date) {
  const data       = await mocdoc.getIPDischarges(date);
  const discharges = data?.discharges || data?.ipdischarges || data?.data || [];
  if (!discharges.length) return;

  for (const d of discharges) {
    const id     = String(d.ip_id || d.discharge_id || d.id || '');
    const phone  = normalisePhone(d.mobile || d.patient_mobile);
    const name   = d.patient_name || d.name || 'Patient';
    const doctor = d.doctor_name  || d.dr_name || d.doctor || '';
    const spec   = d.specialty    || d.department || d.dept || '';

    if (!phone || !id || seen.discharges.has(id)) continue;
    seen.discharges.add(id);

    await engagement.onDischarge({ phone, patientName: name, doctor, specialty: spec, admissionId: id });

    // Schedule 3-day post-discharge check — stored durably for the same
    // restart-safety reason as the IP Day 2 message above.
    const postDischargeDueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await db.scheduleDelayedMessage({
      messageType: 'post_discharge',
      phone,
      payload: { phone, patientName: name, doctor, specialty: spec, admissionId: id },
      dueAt: postDischargeDueAt,
    });

    // Schedule 30-day recall
    await db.scheduleRecall({ phone, name, specialty: spec, daysFromNow: 30 }).catch(() => {});
  }
}

// ── 5. LAB ORDERS — prep instructions ────────────────────────────────────────
async function syncLabOrders(date) {
  const data   = await mocdoc.getLabOrders(date);
  const orders = data?.laborders || data?.orders || data?.data || [];
  if (!orders.length) return;

  for (const o of orders) {
    const id    = String(o.lab_order_id || o.order_id || o.id || '');
    const phone = normalisePhone(o.mobile || o.patient_mobile);
    const name  = o.patient_name || o.name || 'Patient';
    const test  = o.test_name    || o.investigation || o.test || 'Lab test';
    const doc   = o.doctor_name  || o.dr_name || o.doctor || '';

    if (!phone || !id || seen.labOrders.has(id)) continue;
    seen.labOrders.add(id);

    await engagement.onLabVisit({ phone, name, testName: test, labVisitId: id });
    console.log(`[sync] Lab prep sent: ${name} — ${test}`);
  }
}

// ── 6. LAB RESULTS — report ready notification ────────────────────────────────
async function syncLabResults(date) {
  const data    = await mocdoc.getLabResults(date);
  const results = data?.labresults || data?.results || data?.data || [];
  if (!results.length) return;

  for (const r of results) {
    const id    = String(r.lab_order_id || r.result_id || r.id || '');
    const phone = normalisePhone(r.mobile || r.patient_mobile);
    const name  = r.patient_name || r.name || 'Patient';
    const test  = r.test_name    || r.investigation || r.test || 'Lab test';
    const doc   = r.doctor_name  || r.dr_name || r.doctor || '';

    if (!phone || !id || seen.labResults.has(id)) continue;
    seen.labResults.add(id);

    await engagement.onLabReportReady({ phone, name, testName: test, doctor: doc, labVisitId: id });
  }
}

// ── 7. IP ROOM / WARD TRANSFERS — notify attender of a ward change ────────────
async function syncRoomTransfers() {
  // getIPRoomTransfers() defaults to today in YYYYMMDD (POST /api/get/transferroom).
  const data      = await mocdoc.getIPRoomTransfers();
  const transfers = data?.transferroomlist || data?.transfers || data?.data || [];
  if (!transfers.length) return;

  for (const t of transfers) {
    // Some response field names sit behind "View Full Parameters" in the MocDoc
    // docs — read defensively with aliases and tighten once confirmed.
    const id       = String(t.roomallocationkey || t.transfer_id || t.id || '');
    const phone    = normalisePhone(t.mobile || t.patient_mobile || t.mobileno);
    const attender = normalisePhone(t.attender_mobile || t.attender_phone || t.relative_mobile);
    const name     = t.patient_name || t.name || 'Patient';
    const fromWard = t.from_room || t.from_ward || t.old_ward || '';
    const toWard   = t.to_room   || t.new_ward  || t.room || t.ward || '';

    if (!id || seen.roomTransfers.has(id)) continue;
    seen.roomTransfers.add(id);

    const targetPhone = attender || phone;
    if (targetPhone) {
      await engagement.onRoomTransfer({
        attenderPhone: targetPhone,
        patientName:   name,
        fromWard, toWard,
        transferId:    id,
      });
    }
  }
}

// ── 7. OP BILLS — post-consultation trigger (bill = visit complete) ───────────
async function syncOPBills(date) {
  const data  = await mocdoc.getBills(date);
  const bills = data?.bills || data?.data || [];
  if (!bills.length) return;

  for (const b of bills) {
    const id    = String(b.bill_id || b.id || '');
    const phone = normalisePhone(b.mobile || b.patient_mobile);
    const name  = b.patient_name || b.name || 'Patient';
    const doc   = b.doctor_name  || b.dr_name || b.doctor || '';
    const spec  = b.specialty    || b.department || b.dept || '';
    const type  = (b.bill_type   || b.type || '').toUpperCase();

    if (!phone || !id || seen.bills.has(id)) continue;

    // OP bills only — IP bills handled via discharge flow
    if (type === 'IP') continue;

    seen.bills.add(id);

    // Bill generated = consultation completed — fire post-consultation engagement
    await engagement.onConsultationComplete({
      phone, name, doctor: doc, specialty: spec,
      followUpDate: b.followup_date || null,
    });
  }
}

// ── Main sync — runs all seven pollers ────────────────────────────────────────
// ── Process durable delayed-message queue ─────────────────────────────────────
// Picks up anything due from delayed_message_queue (IP Day 2, post-discharge)
// and sends it. Runs as part of the same 60s sync loop, so timing precision
// matches the existing IP admission/discharge polling — a message becomes
// "due" sometime in the prior minute and gets picked up on the next tick.
async function processDelayedMessages() {
  const handlers = {
    ip_day2:        (p) => engagement.onIPDay2(p),
    post_discharge: (p) => engagement.onPostDischarge(p),
  };

  for (const messageType of Object.keys(handlers)) {
    const due = await db.getDueDelayedMessages(messageType);
    for (const row of due) {
      try {
        const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        await handlers[messageType](payload);
        await db.markDelayedMessageSent(row.id);
      } catch (err) {
        console.error(`[sync] delayed message ${messageType} (id ${row.id}) failed:`, err.message);
        await db.markDelayedMessageFailed(row.id).catch(() => {});
      }
    }
    if (due.length) console.log(`[sync] Delayed messages (${messageType}): ${due.length} sent`);
  }
}

async function sync() {
  const date = mocdoc.today();
  console.log(`[sync] Running — ${date}`);

  // Run with error isolation so one failure doesn't block others
  // MocDoc requires 3s between requests — throttle() in mocdoc.js handles this
  // NOTE: Appointment Confirmation, Reschedule, Cancellation, Check In/Out,
  // and OP Bill events are now handled via MocDoc webhooks (server/routes/webhooks.js).
  // Only events WITHOUT webhooks are polled here.
  const tasks = [
    ['New patients',  () => syncNewPatients(date)],   // No webhook available
    ['IP admissions', () => syncIPAdmissions(date)],  // No webhook available
    ['IP discharges', () => syncIPDischarges(date)],  // No webhook available
    ['Lab orders',    () => syncLabOrders(date)],     // No webhook available
    ['Lab results',   () => syncLabResults(date)],    // No webhook available
    ['Room transfers', () => syncRoomTransfers()],    // No webhook — pull /api/get/transferroom
    ['Delayed messages', () => processDelayedMessages()], // IP Day 2 / post-discharge — durable queue
    // OP visits & bills now covered by Check In/Out + OP Bill webhooks
    // ['OP visits',  () => syncOPVisits(date)],      // Replaced by webhooks
    // ['OP bills',   () => syncOPBills(date)],       // Replaced by webhooks
  ];

  for (const [label, task] of tasks) {
    try {
      await task();
    } catch (err) {
      console.error(`[sync] ${label} error:`, err.message);
    }
    // Extra gap between pollers on top of mocdoc.js throttle
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('[sync] Complete');
}

// ── Start the sync loop ───────────────────────────────────────────────────────
function start(intervalMs = 60 * 1000) {
  const hasCreds = process.env.MOCDOC_ENTITY_KEY &&
                   process.env.MOCDOC_ACCESS_KEY  &&
                   process.env.MOCDOC_SECRET;

  if (!hasCreds) {
    console.log('[sync] MocDoc credentials not set — sync disabled. Add MOCDOC_ENTITY_KEY, MOCDOC_ACCESS_KEY, MOCDOC_SECRET to .env');
    return;
  }

  console.log(`[sync] MocDoc sync started — polling every ${intervalMs / 1000}s`);

  // First run after 10s (give server time to fully boot)
  setTimeout(() => sync().catch(console.error), 10000);

  // Then every intervalMs
  setInterval(() => sync().catch(console.error), intervalMs);
}

// ── Webhook receiver — drop-in replacement when MocDoc releases webhooks ──────
// When MocDoc deploys webhooks, register this URL with them:
// POST https://your-server.com/mocdoc/webhook
// Then remove the polling sync and this handler fires instead.
// The engagement calls below are identical to the polling handlers above.
async function handleWebhook(event, data) {
  const phone  = normalisePhone(data.patient_mobile || data.mobile);
  const name   = data.patient_name || data.name || 'Patient';
  const doctor = data.doctor_name  || data.doctor || '';
  const spec   = data.specialty    || data.department || '';

  switch (event) {
    case 'patient.registered':
      return engagement.onEnquiry({ phone, name });

    case 'appointment.confirmed':
      await engagement.onAppointmentBooked({ phone, name, doctor, specialty: spec, datetime: data.datetime });
      return db.scheduleRecall({ phone, name, specialty: spec, daysFromNow: 30 }).catch(() => {});

    case 'appointment.completed':
    case 'op.bill.created':
      return engagement.onConsultationComplete({ phone, name, doctor, specialty: spec, followUpDate: data.followup_date });

    case 'appointment.noshow':
      return db.addNoShow({ phone, name, doctor, specialty: spec, originalDt: data.datetime });

    case 'ip.admitted':
      return engagement.onIPAdmission({ attenderPhone: normalisePhone(data.attender_mobile) || phone, patientName: name, ward: data.ward, doctor, admissionId: data.ip_id });

    case 'ip.discharged':
      return engagement.onDischarge({ phone, patientName: name, doctor, specialty: spec, admissionId: data.ip_id });

    case 'lab.order.created':
      return engagement.onLabVisit({ phone, name, testName: data.test_name, labVisitId: data.lab_order_id });

    case 'lab.result.ready':
      return engagement.onLabReportReady({ phone, name, testName: data.test_name, doctor, labVisitId: data.lab_order_id });

    default:
      console.log(`[webhook] Unknown event: ${event}`);
  }
}

module.exports = { start, handleWebhook, sync, processDelayedMessages };
