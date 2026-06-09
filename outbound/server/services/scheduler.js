/* Flamingo Healthcare — Automated Personalised Message Scheduler
 *
 * Runs daily at 9:00 AM and handles:
 *   1. Birthday messages            — patients whose DOB matches today
 *   2. Anniversary messages         — patients whose first_visit matches today (yearly)
 *   3. Post-visit health reminders  — 7 days after last consultation
 *   4. Festival greetings           — major Indian festivals (auto-detected)
 *   5. Recall messages              — 30/60/90-day due recalls
 *   6. No-show recovery             — missed appointment follow-ups
 *   7. Opt-in check                 — patients who haven't been contacted in 90+ days
 *
 * All personalised messages respect opt_in = TRUE.
 * All are dedup-guarded so never send twice.
 */
const engagement = require('./engagement');
const db         = require('./db');
const config     = require('../config');

const pool = new (require('pg').Pool)(config.db);
const q = (s,p) => pool.query(s,p).then(r=>r.rows);

// ── 1. BIRTHDAY ───────────────────────────────────────────────────────────────
async function runBirthdays() {
  const patients = await q(`
    SELECT * FROM patient_profiles
    WHERE dob IS NOT NULL
      AND TO_CHAR(dob,'MM-DD') = TO_CHAR(NOW(),'MM-DD')
      AND opt_in = TRUE
  `);
  for (const p of patients) {
    await engagement.onBirthday({ phone: p.phone, name: p.name });
  }
  if (patients.length) console.log(`[scheduler] Birthdays: ${patients.length} sent`);
  // Note: birthday message defined in engagement.js — no check-up offer
}

// ── 2. FIRST VISIT ANNIVERSARY ────────────────────────────────────────────────
async function runAnniversaries() {
  // Patients whose first message was sent on this calendar day in a prior year
  const patients = await q(`
    SELECT DISTINCT ON (phone) phone, patient_name AS name
    FROM outbound_messages
    WHERE TO_CHAR(sent_at,'MM-DD') = TO_CHAR(NOW(),'MM-DD')
      AND EXTRACT(YEAR FROM sent_at) < EXTRACT(YEAR FROM NOW())
      AND phone IN (SELECT phone FROM patient_profiles WHERE opt_in = TRUE)
    ORDER BY phone, sent_at ASC
  `);
  for (const p of patients) {
    await engagement.sendPersonalised({
      phone: p.phone,
      name:  p.name,
      triggerType: 'anniversary',
      message:
        `Hi {name}! 🌟 On this day last year, you first visited Flamingo Healthcare.\n\n` +
        `We are grateful for your trust in us. Your health is always our priority.\n\n` +
        `📅 Due for a check-up? Book here: {book}\n📞 {phone}`,
    });
  }
  if (patients.length) console.log(`[scheduler] Anniversaries: ${patients.length} sent`);
}

// ── 3. POST-VISIT HEALTH REMINDER (7 days after last message) ─────────────────
async function runPostVisitReminders() {
  // Patients whose last outbound message was ~7 days ago and last trigger was post_consultation
  const patients = await q(`
    SELECT DISTINCT ON (om.phone) om.phone, om.patient_name AS name,
           pp.specialty, pp.doctor
    FROM outbound_messages om
    JOIN patient_profiles pp ON pp.phone = om.phone
    WHERE om.trigger_type = 'post_consultation'
      AND om.sent_at BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '6 days'
      AND pp.opt_in = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM engagement_log el
        WHERE el.phone = om.phone AND el.trigger_type = 'health_reminder_7d'
        AND el.sent_at > NOW() - INTERVAL '7 days'
      )
    ORDER BY om.phone, om.sent_at DESC
  `);
  for (const p of patients) {
    await engagement.sendPersonalised({
      phone: p.phone,
      name:  p.name,
      triggerType: 'health_reminder_7d',
      message:
        `Hi {name}! 👋 It has been a week since your visit to Flamingo Healthcare.\n\n` +
        `How are you feeling? If you have any concerns or need a follow-up with ` +
        `${p.doctor ? `Dr. ${p.doctor}` : 'your doctor'}, we are here.\n\n` +
        `📅 Book a follow-up: {book}\n📞 {phone}`,
    });
  }
  if (patients.length) console.log(`[scheduler] Post-visit 7d reminders: ${patients.length} sent`);
}

// ── 4. FESTIVAL GREETINGS ─────────────────────────────────────────────────────
// Checks if today is a major Indian festival and sends greetings to all opted-in patients
function getTodaysFestival() {
  const now   = new Date();
  const mm    = String(now.getMonth() + 1).padStart(2, '0');
  const dd    = String(now.getDate()).padStart(2, '0');
  const mmdd  = `${mm}-${dd}`;
  const year  = now.getFullYear();

  // Fixed-date festivals
  const fixed = {
    '01-01': { name: 'New Year',           emoji: '🎆', msg: 'Wishing you a happy and healthy New Year!' },
    '01-14': { name: 'Pongal',             emoji: '🌾', msg: 'Happy Pongal! May this harvest season bring you joy and good health.' },
    '01-26': { name: 'Republic Day',       emoji: '🇮🇳', msg: 'Happy Republic Day! Proud to serve our community\'s health.' },
    '08-15': { name: 'Independence Day',   emoji: '🇮🇳', msg: 'Happy Independence Day! Your health is our freedom to serve.' },
    '10-02': { name: 'Gandhi Jayanti',     emoji: '🕊️', msg: 'On Gandhi Jayanti, we recommit to serving your health with care.' },
    '12-25': { name: 'Christmas',          emoji: '🎄', msg: 'Merry Christmas! Wishing you health, joy and peace.' },
    '04-14': { name: 'Tamil New Year',     emoji: '🌺', msg: 'Happy Tamil New Year! இனிய புத்தாண்டு நல்வாழ்த்துக்கள்!' },
    '11-01': { name: 'Kannada Rajyotsava', emoji: '🌼', msg: 'Warm festival greetings from Flamingo Healthcare!' },
  };

  return fixed[mmdd] || null;
}

async function runFestivalGreetings() {
  const festival = getTodaysFestival();
  if (!festival) return;

  const patients = await q(`
    SELECT phone, name FROM patient_profiles
    WHERE opt_in = TRUE
    LIMIT 10000
  `);

  if (!patients.length) return;

  const triggerType = `festival_${festival.name.toLowerCase().replace(/\s+/g,'_')}`;
  const message =
    `${festival.emoji} ${festival.name} greetings from Flamingo Healthcare!\n\n` +
    `Hi {name}! ${festival.msg}\n\n` +
    `We are always here for your healthcare needs.\n📞 044-2658 2424`;

  for (const p of patients) {
    await engagement.sendPersonalised({ phone: p.phone, name: p.name, triggerType, message });
    await new Promise(r => setTimeout(r, 15));
  }

  console.log(`[scheduler] Festival (${festival.name}): ${patients.length} sent`);
}

// ── 5. RECALL MESSAGES ────────────────────────────────────────────────────────
async function runRecalls() {
  const recalls = await db.getDueRecalls();
  for (const r of recalls) {
    await engagement.onRecallDue({
      phone: r.phone, name: r.name,
      specialty: r.specialty, recallDays: r.recall_days, recallId: r.id,
    });
  }
  if (recalls.length) console.log(`[scheduler] Recalls: ${recalls.length} sent`);
}

// ── 6. NO-SHOW RECOVERY ───────────────────────────────────────────────────────
async function runNoShowRecovery() {
  const noShows = await db.getPendingNoShows();
  for (const n of noShows) {
    await engagement.onMissedFollowUp({
      phone: n.phone, name: n.name, doctor: n.doctor,
      specialty: n.specialty, originalDt: n.original_dt, queueId: n.id,
    });
  }
  if (noShows.length) console.log(`[scheduler] No-show recovery: ${noShows.length} sent`);
}

// ── 7. RE-ENGAGEMENT (90-day inactive patients) ───────────────────────────────
async function runReEngagement() {
  const patients = await q(`
    SELECT pp.phone, pp.name, pp.specialty
    FROM patient_profiles pp
    LEFT JOIN outbound_messages om
      ON om.phone = pp.phone
      AND om.sent_at > NOW() - INTERVAL '90 days'
      AND om.trigger_type = 're_engagement'
    WHERE pp.opt_in = TRUE
      AND pp.last_contact < NOW() - INTERVAL '90 days'
      AND om.phone IS NULL
    LIMIT 50
  `);

  for (const p of patients) {
    await engagement.sendPersonalised({
      phone: p.phone,
      name:  p.name,
      triggerType: 're_engagement',
      message:
        `Dear {name},\n\n` +
        `This is a courtesy message from Flamingo Healthcare, Ambattur.\n\n` +
        (p.specialty
          ? `As a ${p.specialty} patient, periodic follow-up consultations are recommended to monitor your health effectively.\n\n`
          : `Periodic health consultations are recommended to help maintain and monitor your wellbeing.\n\n`) +
        `To schedule a consultation, please contact us:\n` +
        `📞 044-2658 2424 / +91 9150565888\n` +
        `📅 Book online: {book}\n\n` +
        `Flamingo Healthcare, Ambattur, Chennai`,
    });
    await new Promise(r => setTimeout(r, 15));
  }
  if (patients.length) console.log(`[scheduler] Re-engagement: ${patients.length} sent`);
}

// ── MASTER DAILY JOB ──────────────────────────────────────────────────────────
async function runDailyJobs() {
  console.log(`[scheduler] Daily run at ${new Date().toLocaleTimeString()}`);
  // Run in order — rate-limited by engagement.send() dedup
  await runBirthdays();
  await runAnniversaries();
  await runFestivalGreetings();
  await runRecalls();
  await runNoShowRecovery();
  // These run less aggressively
  const hour = new Date().getHours();
  if (hour === 9) {
    await runPostVisitReminders();
    await runReEngagement();
  }
  console.log('[scheduler] Daily run complete');
}

// ── SCHEDULER ─────────────────────────────────────────────────────────────────
function start() {
  // Schedule daily at 9:00 AM
  function scheduleNext() {
    const now  = new Date();
    const next = new Date();
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    setTimeout(() => {
      runDailyJobs().catch(console.error);
      setInterval(() => runDailyJobs().catch(console.error), 24 * 60 * 60 * 1000);
    }, delay);
    console.log(`[scheduler] Next run: ${next.toLocaleString('en-IN')}`);
  }

  scheduleNext();

  // Also run recalls and no-show recovery every 30 minutes (not just daily)
  setInterval(async () => {
    await runRecalls().catch(console.error);
    await runNoShowRecovery().catch(console.error);
  }, 30 * 60 * 1000);

  // Run once on boot after 10 seconds (skip festival/birthday on boot)
  setTimeout(async () => {
    await runRecalls().catch(console.error);
    await runNoShowRecovery().catch(console.error);
  }, 10000);
}

module.exports = { start, runDailyJobs, runBirthdays, runFestivalGreetings };
