/* Flamingo Healthcare — 12 Outbound WhatsApp Templates
 * Pure outbound — no inbound handling.
 * Every function is dedup-guarded via engagement_log.
 */
const wa     = require('./whatsapp');
const db     = require('./db');
const config = require('../config');

const { name: H, phone: PHONE, mapLink: MAP, reviewLink: REVIEW, bookingUrl: BOOK } = config.hospital;

async function send(phone, type, fn, dedupHrs=24, refId=null, patientName=null, msgText=null) {
  console.log(`[eng] attempting ${type} → ${phone}`);
  const skip = await db.alreadySent(phone, type, dedupHrs).catch(e => {
    console.error(`[eng] dedup check failed: ${e.message}`); return false;
  });
  if (skip) {
    console.log(`[eng] skip ${type} → ${phone} (sent within ${dedupHrs}h)`); return;
  }
  try {
    console.log(`[eng] sending ${type} → ${phone}`);
    await fn();
    await db.logSent(phone, type, refId);
    // Log to outbound history for dashboard
    if (msgText) {
      await db.logOutboundMessage({ phone, patientName, triggerType: type, message: msgText }).catch(()=>{});
    }
    // Upsert patient profile
    if (patientName) {
      await db.upsertPatient({ phone, name: patientName }).catch(()=>{});
    }
    console.log(`[eng] ✓ ${type} → ${phone}`);
  } catch (e) { console.error(`[eng] ✗ ${type} → ${phone}:`, e.message); }
}

// 1. Incoming enquiry / patient registration
async function onEnquiry({ phone, name }) {
  await send(phone, 'enquiry', () => wa.sendText(phone,
    `Hi ${name||'there'}! Thank you for reaching out to ${H} 🙏\n\n` +
    `📅 Book an appointment: ${BOOK}\n` +
    `📍 Ambattur, Chennai\n` +
    `🕐 Mon–Sat: 8:00 AM – 7:00 PM  |  Emergency: 24/7\n` +
    `📞 ${PHONE}`
  ), 6);
}

// Best-effort parse of a MocDoc appointment datetime into a JS Date, used to
// schedule the same-day reminder. Handles ISO, "YYYYMMDD HH:mm",
// "YYYY-MM-DD HH:mm", and "DD-MM-YYYY HH:mm". Adjust if MocDoc's actual
// appointment datetime format differs from these.
function parseApptTime(s) {
  if (!s) return null;
  const str = String(s).trim();
  const iso = new Date(str);
  if (!isNaN(iso)) return iso;
  let m = str.match(/^(\d{4})(\d{2})(\d{2})[ T]?(\d{2}):(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  m = str.match(/^(\d{2})-(\d{2})-(\d{4})[ T]?(\d{2}):(\d{2})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
  return null;
}

// 2. Appointment booked — confirmation
async function onAppointmentBooked({ phone, name, doctor, specialty, datetime, apptKey, notes }) {
  const notesLine = notes ? `\n📝 Notes: ${notes}` : '';
  const msg =
    `Appointment confirmed ✅\n\n` +
    `👤 ${name}\n` +
    `👨‍⚕️ ${doctor}\n` +
    (specialty ? `🏥 ${specialty}\n` : '') +
    `📅 ${datetime}\n` +
    `📍 ${H}\n` +
    notesLine +
    `\n📋 Please carry:\n• Photo ID\n• Previous reports / prescriptions\n• Insurance card (if any)\n\n` +
    `To reschedule or cancel, call: ${PHONE}`;
  await send(phone, 'appt_booked', () => wa.sendText(phone, msg), 1, apptKey, name, msg);

  // Schedule the same-day "2 hours before" reminder off the appointment time.
  // In-process timer: it's lost if the service restarts, which is fine for a
  // same-day reminder. The durable long-term home is a periodic job in
  // scheduler.js that scans today's appointments; this covers the common case.
  try {
    const apptTime = parseApptTime(datetime);
    if (apptTime) {
      const delay = apptTime.getTime() - 2 * 60 * 60 * 1000 - Date.now();
      // Only schedule if the reminder is in the future and within ~26h (today).
      if (delay > 0 && delay < 26 * 60 * 60 * 1000) {
        setTimeout(() => {
          onSameDayReminder({ phone, name, doctor, datetime }).catch(() => {});
        }, delay);
      }
    }
  } catch { /* unparseable datetime — confirmation already sent, skip reminder */ }
}

// 3. Same-day reminder (2 hours before)
async function onSameDayReminder({ phone, name, doctor, datetime }) {
  await send(phone, 'reminder_2h', () => wa.sendText(phone,
    `Reminder: Your appointment is in 2 hours ⏰\n\n` +
    `👨‍⚕️ ${doctor}\n` +
    `📅 ${datetime}\n` +
    `📍 ${H}\n` +
    `🗺️ ${MAP}\n` +
    `📞 ${PHONE}\n\n` +
    `Please arrive 10 minutes early.`
  ), 12);
}

// 4. After OP consultation
async function onConsultationComplete({ phone, name, doctor, specialty, followUpDate }) {
  const fu = followUpDate
    ? `\n📅 Follow-up: ${followUpDate}`
    : `\n💬 Need a follow-up? Call ${PHONE}`;
  await send(phone, 'post_consultation', () => wa.sendText(phone,
    `Thank you for visiting ${H}, ${name||'dear patient'} 🙏\n\n` +
    `We hope your consultation with ${doctor} (${specialty}) was helpful.${fu}\n\n` +
    `⭐ Your feedback matters:\n${REVIEW}\n\n` +
    `Take care and see you again!`
  ), 48);
}

// 5a. Lab / scan visit — prep instructions
async function onLabVisit({ phone, name, testName, labVisitId }) {
  await send(phone, 'lab_prep', () => wa.sendText(phone,
    `Hi ${name||'there'}! Your ${testName} is scheduled at ${H}.\n\n` +
    `📋 Preparation:\n${labPrep(testName)}\n\n` +
    `We will notify you when your report is ready.\n` +
    `Questions? Call: ${PHONE}`
  ), 24, labVisitId);
}

// 5b. Lab report ready
async function onLabReportReady({ phone, name, testName, doctor, labVisitId }) {
  await send(phone, 'lab_report_ready', () => wa.sendText(phone,
    `Your ${testName} report is ready 📄\n\n` +
    `Collect it at the ${H} reception or ask Dr. ${doctor} to review it.\n\n` +
    `📅 Book a follow-up: ${BOOK}\n` +
    `📞 ${PHONE}`
  ), 48, labVisitId);
}

// 6. IP admission — to attender
async function onIPAdmission({ attenderPhone, patientName, ward, doctor, admissionId }) {
  await send(attenderPhone, 'ip_admission', () => wa.sendText(attenderPhone,
    `${patientName} has been admitted to ${H} 🏥\n\n` +
    `🛏️ Ward: ${ward}\n` +
    `👨‍⚕️ Doctor: ${doctor}\n\n` +
    `🕐 Visiting hours: 9–12 AM and 4–7 PM\n` +
    `📞 Helpdesk (24/7): ${PHONE}`
  ), 999, admissionId);
}

// 7. IP Day 2 — feedback
async function onIPDay2({ attenderPhone, patientName, admissionId }) {
  await send(attenderPhone, 'ip_day2', () => wa.sendText(attenderPhone,
    `Hi! Flamingo Healthcare checking in on ${patientName}'s stay 🏥\n\n` +
    `How has the experience been so far?\n\n` +
    `1️⃣ Excellent\n2️⃣ Good\n3️⃣ Needs improvement\n\n` +
    `Reply 1, 2, or 3 — your feedback helps us improve.`
  ), 999, admissionId);
}

// IP room / ward transfer — notify the attender of a move
async function onRoomTransfer({ attenderPhone, patientName, fromWard, toWard, transferId }) {
  if (!attenderPhone) return;
  const fromLine = fromWard ? `From: ${fromWard}\n` : '';
  await send(attenderPhone, 'ip_room_transfer', () => wa.sendText(attenderPhone,
    `Update on ${patientName || 'your patient'}'s stay at ${H} 🏥\n\n` +
    `🛏️ Room/ward change\n` +
    fromLine +
    `To: ${toWard || 'a new ward'}\n\n` +
    `🕐 Visiting hours: 9–12 AM and 4–7 PM\n` +
    `📞 Helpdesk (24/7): ${PHONE}`
  ), 999, transferId, patientName);
}

// 8. At discharge
async function onDischarge({ phone, patientName, doctor, specialty, admissionId }) {
  await send(phone, 'discharge', () => wa.sendText(phone,
    `${patientName}, we are glad you are going home! 🎉\n\n` +
    `📋 Instructions from Dr. ${doctor}:\n` +
    `• Take all medications on time\n` +
    `• Avoid strenuous activity for 7 days\n` +
    `• Keep wounds clean and dry\n` +
    `• Return immediately if fever, severe pain, or worsening symptoms\n\n` +
    `⭐ Leave a review:\n${REVIEW}\n\n` +
    `📅 Book your follow-up: ${BOOK}\n` +
    `Wishing you a speedy recovery! 🙏`
  ), 999, admissionId);
}

// 9. 3-5 days post discharge
async function onPostDischarge({ phone, patientName, doctor, specialty, admissionId }) {
  await send(phone, 'post_discharge', () => wa.sendText(phone,
    `Hi ${patientName}! Flamingo Healthcare checking in 🤗\n\n` +
    `It has been a few days since your discharge. How are you feeling?\n\n` +
    `If you have any concerns, do not wait.\n` +
    `📅 Book a follow-up with Dr. ${doctor}: ${BOOK}\n` +
    `📞 Call us: ${PHONE}`
  ), 999, admissionId);
}

// 10. Missed follow-up / no-show
async function onMissedFollowUp({ phone, name, doctor, specialty, originalDt, queueId }) {
  await send(phone, 'missed_followup', async () => {
    await wa.sendText(phone,
      `Hi ${name}! We noticed you missed your appointment with ${doctor} (${specialty}) on ${originalDt}.\n\n` +
      `We understand. Would you like to reschedule?\n\n` +
      `📅 Book a new slot: ${BOOK}\n` +
      `📞 Or call us: ${PHONE}`
    );
    await db.markNoShowRecovered(queueId);
  }, 72, queueId);
}

// 11. Monthly health broadcast (segmented)
async function sendBroadcast({ recipients, message }) {
  let sent=0, failed=0;
  for (const { phone, name } of recipients) {
    try {
      await wa.sendText(phone, message.replace('{name}', name||'dear patient'));
      await db.logSent(phone, `broadcast_${Date.now()}`);
      sent++;
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 15));
  }
  console.log(`[broadcast] sent:${sent} failed:${failed}`);
  return { sent, failed };
}

// 12. Post visit follow up — 30/60/90-day check-in after consultation
async function onRecallDue({ phone, name, specialty, recallDays, recallId }) {
  await send(phone, `post_visit_followup_${recallDays}d`, async () => {
    await wa.sendText(phone,
      `Hi ${name}! Flamingo Healthcare checking in.\n\n` +
      `It has been ${recallDays} days since your last visit${specialty ? ` (${specialty})` : ''}.\n\n` +
      `How are you doing? If you need a review or have any concerns, we are here.\n` +
      `📅 Book a follow-up: ${BOOK}\n` +
      `📞 ${PHONE}`
    );
    await db.markRecallSent(recallId);
  }, 999, recallId);
}

// Inbound call — thank you message (sent immediately when someone calls)
async function onIncomingCall({ phone, callerName }) {
  const msg =
    `Thank you for contacting Flamingo Healthcare 🙏\n\n` +
    `We have received your call and our team will get back to you shortly.\n\n` +
    `📍 Flamingo Healthcare, Ambattur, Chennai\n` +
    `📞 044-2658 2424 / +91 9150565888\n` +
    `🕐 Mon–Sat: 8:00 AM – 7:00 PM | Emergency: 24/7\n\n` +
    `To book an appointment: ${BOOK}`;
  await send(phone, 'call_thankyou', () => wa.sendText(phone, msg), 1, null, callerName, msg);
}

// Answered call completed — thank-you after the team has actually spoken with the caller
async function onCallCompleted({ phone, callerName }) {
  const msg =
    `Thank you for calling ${H} 🙏\n\n` +
    `It was our pleasure to assist you. If you have any further questions, our team is always here to help.\n\n` +
    `📅 Book an appointment: ${BOOK}\n` +
    `📞 044-2658 2424 / +91 9150565888\n` +
    `🕐 Mon–Sat: 8:00 AM – 7:00 PM | Emergency: 24/7\n` +
    `📍 Ambattur, Chennai`;
  await send(phone, 'call_completed', () => wa.sendText(phone, msg), 1, null, callerName, msg);
}
// Missed call — callback follow-up (sent if call was not answered)
async function onMissedCall({ phone, callerName }) {
  const msg =
    `Dear ${callerName||'Patient'},\n\n` +
    `We noticed your call to Flamingo Healthcare went unanswered. We apologise for the inconvenience.\n\n` +
    `Our team will call you back shortly.\n\n` +
    `📞 044-2658 2424 / +91 9150565888\n` +
    `📅 Book online: ${BOOK}`;
  // No dedup window (0 hours) — every missed call gets its own message, even
  // repeat calls from the same number within the same hour. A genuinely
  // worried patient calling back multiple times because nobody answered
  // should keep getting acknowledged, not go silent after the first one.
  await send(phone, 'missed_call_wa', () => wa.sendText(phone, msg), 0, null, callerName, msg);
}

// Background jobs
async function runJobs() {
  const recalls = await db.getDueRecalls();
  for (const r of recalls)
    await onRecallDue({ phone:r.phone, name:r.name, specialty:r.specialty, recallDays:r.recall_days, recallId:r.id });

  const noShows = await db.getPendingNoShows();
  for (const n of noShows)
    await onMissedFollowUp({ phone:n.phone, name:n.name, doctor:n.doctor, specialty:n.specialty, originalDt:n.original_dt, queueId:n.id });
}

function labPrep(test='') {
  const t = test.toLowerCase();
  if (t.match(/blood|glucose|hba1c|lipid|cholesterol/)) return '• Fast 8–12 hours\n• Water only\n• Continue medications unless told otherwise';
  if (t.includes('urine'))   return '• First morning sample\n• Use sterile container provided';
  if (t.match(/mri|ct|scan/)) return '• Remove all metal jewellery\n• Inform us of any implants\n• Eat normally unless advised otherwise';
  if (t.match(/ecg|echo/))   return '• Wear loose clothing\n• No lotion on chest\n• Continue medications';
  if (t.includes('x-ray'))   return '• No metal zippers in area\n• Inform us if pregnant';
  return '• Arrive 10 minutes early\n• Carry prescription or referral\n• Follow doctor\'s instructions';
}

module.exports = {
  onEnquiry, onAppointmentBooked, onSameDayReminder,
  onConsultationComplete, onLabVisit, onLabReportReady,
  onIPAdmission, onIPDay2, onDischarge, onPostDischarge,
  onMissedFollowUp, sendBroadcast, onRecallDue,
  onIncomingCall, onMissedCall, runJobs,
  onBirthday, sendPersonalised, sendHealthBroadcast, sendOffer, runBirthdayJob,
};

// ── BIRTHDAY MESSAGE ──────────────────────────────────────────────────────────
async function onBirthday({ phone, name }) {
  const msg =
    `Happy Birthday, ${name}! 🎂\n\n` +
    `The entire team at ${H} wishes you a wonderful birthday filled with joy and good health.\n\n` +
    `📞 ${PHONE}`;
  await send(phone, 'birthday', () => wa.sendText(phone, msg), 364, null, name, msg);
}

// ── PERSONALISED MESSAGE — custom for any occasion ────────────────────────────
async function sendPersonalised({ phone, name, message, triggerType='personalised' }) {
  const personalised = message
    .replace(/{name}/gi, name || 'dear patient')
    .replace(/{hospital}/gi, H)
    .replace(/{phone}/gi, PHONE)
    .replace(/{book}/gi, BOOK);
  await send(phone, triggerType, () => wa.sendText(phone, personalised), 0, null, name, personalised);
}

// ── HEALTH TIP BROADCAST ──────────────────────────────────────────────────────
async function sendHealthBroadcast({ recipients, message, campaignName }) {
  let sent=0, failed=0;
  const broadcastId = await db.createBroadcastCampaign({
    name: campaignName || 'Broadcast', message, recipientCount: recipients.length,
  }).catch(() => null);
  for (const { phone, name } of recipients) {
    try {
      const personalised = message
        .replace(/{name}/gi, name||'dear patient')
        .replace(/{hospital}/gi, H)
        .replace(/{book}/gi, BOOK)
        .replace(/{phone}/gi, PHONE);
      await wa.sendText(phone, personalised);
      await db.logSent(phone, `broadcast_${Date.now()}`);
      await db.logOutboundMessage({ phone, patientName:name, triggerType:'broadcast', message:personalised, broadcastId }).catch(()=>{});
      await db.upsertPatient({ phone, name }).catch(()=>{});
      sent++;
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 15));
  }
  if (broadcastId) {
    await db.updateBroadcastCounts(broadcastId, sent, failed).catch(()=>{});
  } else {
    // Fallback if campaign row creation failed — at least record the summary.
    await db.logBroadcast({ name:campaignName||'Broadcast', message, recipientCount:recipients.length, sent, failed }).catch(()=>{});
  }
  console.log(`[broadcast] "${campaignName}" — sent:${sent} failed:${failed}`);
  return { sent, failed, broadcastId };
}

// Renders a template's raw body_text (with {{1}}, {{2}}... placeholders)
// into the actual text a given recipient receives — mirrors the frontend's
// renderTemplatePreview() in utils.ts so Message History shows exactly what
// was sent, not a generic "Template send: <name>" placeholder.
function renderTemplateBody(bodyText, params) {
  if (!bodyText) return null;
  return bodyText.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const i = parseInt(n, 10) - 1;
    const v = params[i];
    return (v !== undefined && v !== null && String(v).trim()) ? String(v) : `{{${n}}}`;
  });
}

// Generic template broadcast — paramsFor(name) returns the {{1}},{{2}}… values per recipient.
// bodyText (optional): the template's raw body with {{n}} placeholders — when
// provided, each recipient's actual rendered message is logged to Message
// History instead of the generic logMessage/templateName fallback.
async function broadcastTemplate({ recipients, templateName, lang = 'en', paramsFor, bookUrl = BOOK, campaignName, logMessage, headerMediaId, bodyText }) {
  let sent = 0, failed = 0;
  const broadcastId = await db.createBroadcastCampaign({
    name: campaignName || templateName, message: logMessage || templateName,
    recipientCount: recipients.length,
  }).catch(() => null);
  for (const { phone, name } of recipients) {
    try {
      const params = paramsFor(name);
      await wa.sendTemplate(phone, templateName, lang, params, bookUrl,
        { patientName: name, triggerType: 'broadcast', headerMediaId });
      await db.logSent(phone, `broadcast_${Date.now()}`);
      // Prefer the real rendered message text (what the recipient actually
      // received) over the generic logMessage fallback, when we have the
      // template's body_text to render it with.
      const renderedMessage = renderTemplateBody(bodyText, params) || logMessage || templateName;
      await db.logOutboundMessage({ phone, patientName: name, triggerType: 'broadcast', message: renderedMessage, broadcastId }).catch(() => {});
      await db.upsertPatient({ phone, name }).catch(() => {});
      sent++;
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 50)); // Meta tier limits still apply
  }
  if (broadcastId) {
    await db.updateBroadcastCounts(broadcastId, sent, failed).catch(() => {});
  } else {
    await db.logBroadcast({ name: campaignName || templateName, message: logMessage || templateName, recipientCount: recipients.length, sent, failed }).catch(() => {});
  }
  console.log(`[broadcast] ${templateName} "${campaignName}" — sent:${sent} failed:${failed}`);
  return { sent, failed, broadcastId };
}

async function sendHealthTip({ recipients, tip, campaignName }) {
  return broadcastTemplate({
    recipients, templateName: 'monthly_health_tip',
    paramsFor: (name) => [name || 'there', tip],
    campaignName: campaignName || 'Health Tip', logMessage: tip,
  });
}

async function sendOfferTemplate({ recipients, offerTitle, offerDetails, validTill }) {
  return broadcastTemplate({
    recipients, templateName: 'health_package_offer',
    paramsFor: (name) => [name || 'there', offerTitle, offerDetails, validTill || 'Limited period'],
    campaignName: offerTitle, logMessage: `${offerTitle}: ${offerDetails}`,
  });
}

async function sendCampInfo({ recipients, campType, date, venue, details }) {
  return broadcastTemplate({
    recipients, templateName: 'health_camp_info',
    paramsFor: (name) => [name || 'there', campType, date, venue, details || 'Walk in or pre-register.'],
    campaignName: `Camp: ${campType}`, logMessage: `${campType} on ${date} at ${venue}`,
  });
}

// ── OFFER / PACKAGE MESSAGE ───────────────────────────────────────────────────
async function sendOffer({ recipients, offerTitle, offerDetails, validTill }) {
  const message =
    `Special offer from ${H} 🏥\n\n` +
    `🎯 ${offerTitle}\n\n` +
    `${offerDetails}\n\n` +
    (validTill ? `⏰ Valid till: ${validTill}\n\n` : '') +
    `📅 Book now: ${BOOK}\n` +
    `📞 ${PHONE}`;
  return sendHealthBroadcast({ recipients, message, campaignName: offerTitle });
}

// ── BIRTHDAY JOB — run daily ──────────────────────────────────────────────────
async function runBirthdayJob() {
  const birthdays = await db.getBirthdaysToday();
  for (const p of birthdays) {
    await onBirthday({ phone: p.phone, name: p.name });
  }
  if (birthdays.length > 0) {
    console.log(`[birthday] Sent ${birthdays.length} birthday messages`);
  }
}



// ── NEW WEBHOOK-DRIVEN FUNCTIONS ──────────────────────────────────────────────

// Check-in start — patient arrives (from Check In webhook)
async function onConsultationStart({ phone, name, doctor, specialty, checkinKey, token }) {
  const tokenLine = token ? `\n🎫 Your token number: *${token}*` : '';
  const msg =
    `Welcome to ${H}, ${name}! 🙏\n\n` +
    `You have checked in with ${doctor}${specialty ? ` (${specialty})` : ''}.${tokenLine}\n\n` +
    `Please wait — you will be called shortly.\n` +
    `📞 ${PHONE}`;
  await send(phone, 'checkin', () => wa.sendText(phone, msg), 4, checkinKey, name, msg);
}

// Bill created — OP bill raised (from OP Bill Creation webhook)
async function onBillCreated({ phone, name, doctor, billNo, amount, amountReceived, paymentType, discount, itemList, billKey }) {
  const itemSection = itemList && itemList.length
    ? `\n📝 Services:\n${itemList.join('\n')}\n`
    : '';
  const discountLine = discount && discount > 0
    ? `🏷️ Discount: ₹${discount}\n`
    : '';
  const paymentLine = paymentType
    ? `💳 Payment: ${paymentType}\n`
    : '';
  const msg =
    `Your bill is ready at ${H} 🧾\n\n` +
    `📋 Bill No: ${billNo}\n` +
    `👨‍⚕️ Consultant: ${doctor}\n` +
    itemSection +
    discountLine +
    (amount        ? `💰 Amount Payable: ₹${amount}\n` : '') +
    (amountReceived ? `✅ Amount Received: ₹${amountReceived}\n` : '') +
    paymentLine +
    `\nFor queries: ${PHONE}`;
  await send(phone, 'op_bill_created', () => wa.sendText(phone, msg), 1, billKey, name, msg);
}

// Bill cancelled (from OP Bill Cancellation webhook)
async function onBillCancelled({ phone, name, billNo, reason, amountPay, cancelledBy }) {
  const msg =
    `Your bill has been cancelled at ${H} 🧾\n\n` +
    `📋 Bill No: ${billNo}\n` +
    (amountPay ? `💰 Bill Amount: ₹${amountPay}\n` : '') +
    (reason    ? `📝 Reason: ${reason}\n` : '') +
    `\nIf you have already made a payment, please contact us for a refund.\n` +
    `📞 ${PHONE}`;
  await send(phone, 'op_bill_cancelled', () => wa.sendText(phone, msg), 1, billNo, name, msg);
}

// Appointment rescheduled (from Appointment Reschedule webhook)
async function onAppointmentRescheduled({ phone, name, doctor, specialty, newDate, oldDate, apptKey, notes }) {
  const oldLine  = oldDate  ? `📅 Previous time: ~${oldDate}~\n` : '';
  const notesLine = notes   ? `\n📝 Notes: ${notes}` : '';
  const msg =
    `Your appointment has been rescheduled ✅\n\n` +
    `👤 ${name}\n` +
    `👨‍⚕️ ${doctor}\n` +
    (specialty ? `🏥 ${specialty}\n` : '') +
    oldLine +
    `📅 New time: ${newDate}\n` +
    `📍 ${H}\n` +
    notesLine +
    `\n📋 Please carry Photo ID and previous reports.\n` +
    `To reschedule or cancel: ${PHONE}`;
  await send(phone, 'appt_rescheduled', () => wa.sendText(phone, msg), 1, apptKey, name, msg);
}

// Appointment cancelled (from Appointment Cancellation webhook)
// cancelPerson: "Doctor" = hospital cancelled, "Patient" = patient cancelled
async function onAppointmentCancelled({ phone, name, doctor, specialty, datetime, reason, cancelPerson, apptKey }) {
  const byDoctor = cancelPerson && cancelPerson.toLowerCase() === 'doctor';

  let msg;
  if (byDoctor) {
    // Hospital / doctor cancelled — more apologetic tone
    msg =
      `Dear ${name},\n\n` +
      `We regret to inform you that your appointment${doctor ? ` with ${doctor}` : ''} at ${H} has been cancelled.\n\n` +
      (datetime ? `📅 Original time: ${datetime}\n` : '') +
      (reason   ? `📝 Reason: ${reason}\n` : '') +
      `\nWe sincerely apologise for the inconvenience.\n` +
      `📅 Please rebook at your convenience: ${BOOK}\n` +
      `📞 ${PHONE}`;
  } else {
    // Patient cancelled — acknowledge and invite rebooking
    msg =
      `Your appointment${doctor ? ` with ${doctor}` : ''} at ${H} has been cancelled.\n\n` +
      (datetime ? `📅 Was scheduled: ${datetime}\n` : '') +
      (reason   ? `📝 Reason: ${reason}\n` : '') +
      `\nWhenever you are ready, we are here for you.\n` +
      `📅 Book again: ${BOOK}\n` +
      `📞 ${PHONE}`;
  }
  await send(phone, 'appt_cancelled', () => wa.sendText(phone, msg), 1, apptKey, name, msg);
}

// Re-export with new functions appended
const _orig = module.exports;
module.exports = {
  ..._orig,
  onConsultationStart,
  onBillCreated,
  onBillCancelled,
  onAppointmentRescheduled,
  onAppointmentCancelled,
  onRoomTransfer,
  onCallCompleted,
  sendHealthTip,
  sendOfferTemplate,
  sendCampInfo,
  broadcastTemplate,
};
