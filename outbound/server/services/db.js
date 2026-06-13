const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool(config.db);

pool.on('error', err => console.error('PG:', err.message));
const q  = (s,p) => pool.query(s,p).then(r=>r.rows);
const q1 = (s,p) => pool.query(s,p).then(r=>r.rows[0]||null);

async function setup() {
  await pool.query(`
    -- Engagement dedup + audit
    CREATE TABLE IF NOT EXISTS engagement_log (
      id           SERIAL PRIMARY KEY,
      phone        TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      ref_id       TEXT,
      sent_at      TIMESTAMPTZ DEFAULT NOW()
    );
    -- 30/60/90-day recall jobs
    CREATE TABLE IF NOT EXISTS recall_schedule (
      id          SERIAL PRIMARY KEY,
      phone       TEXT NOT NULL,
      name        TEXT,
      specialty   TEXT,
      recall_at   TIMESTAMPTZ NOT NULL,
      recall_days INTEGER,
      status      TEXT DEFAULT 'pending'
    );
    -- Missed appointment recovery queue
    CREATE TABLE IF NOT EXISTS follow_up_queue (
      id          SERIAL PRIMARY KEY,
      phone       TEXT NOT NULL,
      name        TEXT,
      doctor      TEXT,
      specialty   TEXT,
      original_dt TEXT,
      status      TEXT DEFAULT 'pending',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
    -- Dialer: every inbound call logged here
    CREATE TABLE IF NOT EXISTS dialer_calls (
      id           SERIAL PRIMARY KEY,
      phone        TEXT NOT NULL,
      caller_name  TEXT,
      duration_sec INTEGER,
      status       TEXT NOT NULL,   -- answered | missed | abandoned
      agent        TEXT,
      notes        TEXT,
      called_at    TIMESTAMPTZ DEFAULT NOW()
    );
    -- Dialer: callback queue (missed calls waiting to be called back)
    CREATE TABLE IF NOT EXISTS callback_queue (
      id          SERIAL PRIMARY KEY,
      phone       TEXT NOT NULL,
      caller_name TEXT,
      missed_at   TIMESTAMPTZ DEFAULT NOW(),
      status      TEXT DEFAULT 'pending',  -- pending | called_back | ignored
      call_id     INTEGER REFERENCES dialer_calls(id)
    );
    CREATE INDEX IF NOT EXISTS idx_eng    ON engagement_log(phone, trigger_type, sent_at);
    CREATE INDEX IF NOT EXISTS idx_recall  ON recall_schedule(recall_at, status);
    CREATE INDEX IF NOT EXISTS idx_calls   ON dialer_calls(called_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cb      ON callback_queue(status);

    -- Outbound message history (every WhatsApp sent)
    CREATE TABLE IF NOT EXISTS outbound_messages (
      id           SERIAL PRIMARY KEY,
      phone        TEXT NOT NULL,
      patient_name TEXT,
      trigger_type TEXT NOT NULL,
      message      TEXT NOT NULL,
      sent_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_om_phone ON outbound_messages(phone, sent_at DESC);
    CREATE INDEX IF NOT EXISTS idx_om_date  ON outbound_messages(sent_at DESC);

    -- Patient profiles (for personalised messages)
    CREATE TABLE IF NOT EXISTS patient_profiles (
      id             SERIAL PRIMARY KEY,
      phone          TEXT UNIQUE NOT NULL,
      name           TEXT,
      lname          TEXT,
      title          TEXT,
      phid           TEXT,
      dob            DATE,
      gender         TEXT,
      email          TEXT,
      blood_group    TEXT,
      marital_status TEXT,
      occupation     TEXT,
      relationship   TEXT,
      spouse_name    TEXT,
      alt_phone      TEXT,
      isdcode        TEXT DEFAULT '91',
      specialty      TEXT,
      doctor         TEXT,
      branch         TEXT DEFAULT 'Ambattur',
      opt_in         BOOLEAN DEFAULT TRUE,
      last_contact   TIMESTAMPTZ,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    );

    -- Migrate existing patient_profiles if columns missing (safe on re-run)
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS lname          TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS title          TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS phid           TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS gender         TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS email          TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS blood_group    TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS marital_status TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS occupation     TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS relationship   TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS spouse_name    TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS alt_phone      TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS isdcode        TEXT DEFAULT '91';

    -- Broadcast lists (saved segments)
    CREATE TABLE IF NOT EXISTS broadcast_lists (
      id           SERIAL PRIMARY KEY,
      name         TEXT NOT NULL,
      description  TEXT,
      phone_count  INTEGER DEFAULT 0,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS broadcast_list_members (
      list_id INTEGER REFERENCES broadcast_lists(id) ON DELETE CASCADE,
      phone   TEXT NOT NULL,
      PRIMARY KEY (list_id, phone)
    );

    -- Broadcast campaign history
    CREATE TABLE IF NOT EXISTS broadcast_campaigns (
      id              SERIAL PRIMARY KEY,
      name            TEXT,
      message         TEXT,
      recipient_count INTEGER,
      sent_count      INTEGER DEFAULT 0,
      failed_count    INTEGER DEFAULT 0,
      sent_at         TIMESTAMPTZ DEFAULT NOW()
    );

    -- DPDP Act: patient consent log
    -- Records first WhatsApp contact as implicit opt-in
    CREATE TABLE IF NOT EXISTS consent_log (
      id           SERIAL PRIMARY KEY,
      phone        TEXT NOT NULL,
      patient_name TEXT,
      consent_type TEXT NOT NULL DEFAULT 'implicit_whatsapp',
      trigger_type TEXT,
      consented_at TIMESTAMPTZ DEFAULT NOW(),
      ip_address   TEXT,
      notes        TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_phone
      ON consent_log(phone);  -- one record per patient (first contact)

    -- Meta delivery tracking: status updates per message
    CREATE TABLE IF NOT EXISTS message_delivery (
      id           SERIAL PRIMARY KEY,
      wa_message_id TEXT NOT NULL,
      phone        TEXT NOT NULL,
      status       TEXT NOT NULL,  -- sent | delivered | read | failed
      error_code   TEXT,
      error_msg    TEXT,
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_wamid
      ON message_delivery(wa_message_id);
    CREATE INDEX IF NOT EXISTS idx_delivery_phone
      ON message_delivery(phone, updated_at DESC);

    -- Outbound messages: add wa_message_id column for delivery tracking
    ALTER TABLE outbound_messages
      ADD COLUMN IF NOT EXISTS wa_message_id TEXT,
      ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'sent',
      ADD COLUMN IF NOT EXISTS consent_recorded BOOLEAN DEFAULT FALSE;

    -- Patient profiles: additional MocDoc registration fields
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS lname            TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS title            TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS phid             TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS gender           TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS email            TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS blood_group      TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS marital_status   TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS occupation       TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS relationship     TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS spouse_name      TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS spouse_age       TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS alt_phone        TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS isdcode          TEXT DEFAULT '91';
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS religion         TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS id_proof         TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS id_proof_details TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS family_id        TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS ext_phid         TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS address_street   TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS address_area     TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS address_landmark TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS address_city     TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS address_state    TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS address_zip      TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS address_country  TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS guardian_name    TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS guardian_phone   TEXT;
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS guardian_address TEXT;

    -- Visits table: one row per checkin/checkout event
    CREATE TABLE IF NOT EXISTS visits (
      id              SERIAL PRIMARY KEY,
      phone           TEXT NOT NULL,
      phid            TEXT,
      opno            TEXT,
      token           INTEGER,
      checkin_date    TEXT,
      checkin_time    TEXT,
      checkout_dt     TEXT,
      doctor          TEXT,
      booked_doctor   TEXT,
      specialty       TEXT,
      nature_of_visit TEXT,
      entity_location TEXT,
      referred_by     TEXT,
      created_by      TEXT,
      follow_up_date  TEXT,
      visit_status    TEXT DEFAULT 'checkin',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_visits_phone ON visits(phone, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_visits_opno  ON visits(opno);

    -- Visits: who performed checkout
    ALTER TABLE visits ADD COLUMN IF NOT EXISTS checked_out_by TEXT;

    -- OP Bills: created / updated / cancelled events from MocDoc
    CREATE TABLE IF NOT EXISTS bills (
      id                  SERIAL PRIMARY KEY,
      bill_no             TEXT,
      bill_date           TEXT,
      phone               TEXT,
      patient_name        TEXT,
      consultant          TEXT,
      saved_by            TEXT,
      saved_at            TEXT,
      payment_type        TEXT,
      nature_of_visit     TEXT,
      chief_complaint     TEXT,
      referred_by         TEXT,
      unregistered_dr     TEXT,
      credit_provider     TEXT,
      discount_amount     NUMERIC,
      discount_percentage NUMERIC,
      amount_received     NUMERIC,
      amount_payable      NUMERIC,
      total_tax           NUMERIC,
      location            TEXT,
      items               JSONB,
      event_type          TEXT DEFAULT 'created',  -- created | updated | cancelled
      event_by            TEXT,
      event_reason        TEXT,
      created_at          TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_bills_no    ON bills(bill_no);
    CREATE INDEX IF NOT EXISTS idx_bills_phone ON bills(phone, created_at DESC);

  `);
  console.log('[db] Schema ready');
}

// ── Engagement ────────────────────────────────────────────────────────────────
const alreadySent = async (phone, type, hrs=24) =>
  !!(await q1(`SELECT id FROM engagement_log WHERE phone=$1 AND trigger_type=$2 AND sent_at>NOW()-($3||' hours')::INTERVAL LIMIT 1`,[phone,type,hrs]));

const logSent = (phone, type, refId=null) =>
  pool.query('INSERT INTO engagement_log(phone,trigger_type,ref_id) VALUES($1,$2,$3)',[phone,type,String(refId||'')]);

// ── Recall ────────────────────────────────────────────────────────────────────
const scheduleRecall = ({phone,name,specialty,daysFromNow}) =>
  pool.query(`INSERT INTO recall_schedule(phone,name,specialty,recall_at,recall_days) VALUES($1,$2,$3,NOW()+($4||' days')::INTERVAL,$4)`,[phone,name,specialty,daysFromNow]).catch(()=>{});

const getDueRecalls = () =>
  q("SELECT * FROM recall_schedule WHERE status='pending' AND recall_at<=NOW()");

const markRecallSent = id =>
  pool.query("UPDATE recall_schedule SET status='sent' WHERE id=$1",[id]);

// ── Follow-up queue ───────────────────────────────────────────────────────────
const addNoShow = ({phone,name,doctor,specialty,originalDt}) =>
  pool.query('INSERT INTO follow_up_queue(phone,name,doctor,specialty,original_dt) VALUES($1,$2,$3,$4,$5)',[phone,name,doctor,specialty,originalDt]);

const getPendingNoShows = () =>
  q("SELECT * FROM follow_up_queue WHERE status='pending' ORDER BY created_at DESC");

const markNoShowRecovered = id =>
  pool.query("UPDATE follow_up_queue SET status='recovered' WHERE id=$1",[id]);

// ── Dialer ────────────────────────────────────────────────────────────────────
async function logCall({phone, callerName, durationSec, status, agent, notes}) {
  const res = await pool.query(
    'INSERT INTO dialer_calls(phone,caller_name,duration_sec,status,agent,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
    [phone, callerName||null, durationSec||null, status, agent||null, notes||null]
  );
  if (status === 'missed') {
    await pool.query(
      'INSERT INTO callback_queue(phone,caller_name,call_id) VALUES($1,$2,$3)',
      [phone, callerName||null, res.rows[0].id]
    );
  }
  return res.rows[0].id;
}

const getCalls = (limit=100) =>
  q('SELECT * FROM dialer_calls ORDER BY called_at DESC LIMIT $1',[limit]);

const getCallbackQueue = () =>
  q("SELECT * FROM callback_queue WHERE status='pending' ORDER BY missed_at ASC");

const markCallbackDone = (id, status='called_back') =>
  pool.query('UPDATE callback_queue SET status=$1 WHERE id=$2',[status,id]);

const getDialerStats = async () => {
  const today = new Date(); today.setHours(0,0,0,0);
  const [total,missed,answered,avgDur] = await Promise.all([
    q1('SELECT COUNT(*) AS n FROM dialer_calls WHERE called_at>=NOW()-INTERVAL \'7 days\''),
    q1("SELECT COUNT(*) AS n FROM dialer_calls WHERE status='missed' AND called_at>=NOW()-INTERVAL '7 days'"),
    q1("SELECT COUNT(*) AS n FROM dialer_calls WHERE status='answered' AND called_at>=NOW()-INTERVAL '7 days'"),
    q1("SELECT ROUND(AVG(duration_sec)) AS avg FROM dialer_calls WHERE status='answered' AND called_at>=NOW()-INTERVAL '7 days'"),
  ]);
  return {
    totalCalls:    parseInt(total?.n||0),
    missedCalls:   parseInt(missed?.n||0),
    answeredCalls: parseInt(answered?.n||0),
    avgDurationSec:parseInt(avgDur?.avg||0),
    pendingCallbacks: (await getCallbackQueue()).length,
  };
};

// ── Dashboard state ───────────────────────────────────────────────────────────
async function listState() {
  const [calls, callbacks, recallRows, fupRows, engLog] = await Promise.all([
    getCalls(200),
    getCallbackQueue(),
    getDueRecalls(),
    getPendingNoShows(),
    q('SELECT trigger_type, COUNT(*) AS n FROM engagement_log GROUP BY trigger_type ORDER BY n DESC'),
  ]);
  const stats = await getDialerStats();
  return { calls, callbacks, recallSchedule: recallRows, followUpQueue: fupRows, engagementStats: engLog, dialerStats: stats };
}

setup().catch(err => { console.error('[db] setup failed:', err.message); process.exit(1); });

module.exports = {
  pool,  // exported for direct query access in whatsapp.js
  alreadySent, logSent,
  scheduleRecall, getDueRecalls, markRecallSent,
  addNoShow, getPendingNoShows, markNoShowRecovered,
  logCall, getCalls, getCallbackQueue, markCallbackDone, getDialerStats,
  listState,
  logOutboundMessage, getOutboundHistory, getOutboundByDate, getPatientMessageHistory,
  upsertPatient, logVisit, getVisits, getPatients, getBirthdaysToday,
  logBill, getBills, getRecentBills,
  getBroadcastLists, createBroadcastList, getBroadcastListMembers,
  logBroadcast, getBroadcastHistory,
  // Consent tracking (DPDP Act)
  recordConsent, hasConsent,
  // Meta delivery status tracking
  updateDeliveryStatus, getDeliveryStats,
  // Webhook rate limiting
  checkWebhookRateLimit,
  setup,
};

// ── Outbound message log (WhatsApp chat history per patient) ──────────────────
// Every outbound message is stored here for the history view
async function logOutboundMessage({ phone, patientName, triggerType, message }) {
  await pool.query(
    `INSERT INTO outbound_messages(phone, patient_name, trigger_type, message)
     VALUES($1,$2,$3,$4)`,
    [phone, patientName||null, triggerType, message]
  );
}

async function getOutboundHistory({ phone, date, limit } = {}) {
  let sql = 'SELECT * FROM outbound_messages';
  const params = [];
  const conds  = [];
  if (phone) { params.push(phone); conds.push(`phone=$${params.length}`); }
  if (date)  { params.push(date);  conds.push(`DATE(sent_at)=$${params.length}`); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY sent_at DESC';
  if (limit) { params.push(limit); sql += ` LIMIT $${params.length}`; }
  return q(sql, params);
}

async function getOutboundByDate() {
  // Returns grouped by date for the history view
  return q(`
    SELECT DATE(sent_at) AS date,
           COUNT(*) AS total,
           COUNT(DISTINCT phone) AS patients
    FROM outbound_messages
    GROUP BY DATE(sent_at)
    ORDER BY date DESC
    LIMIT 60
  `);
}

async function getPatientMessageHistory(phone) {
  return q(
    'SELECT * FROM outbound_messages WHERE phone=$1 ORDER BY sent_at DESC LIMIT 100',
    [phone]
  );
}

// ── Patient profiles (for personalised messages) ──────────────────────────────
async function upsertPatient({
  phone, name, lname, title, phid, ext_phid, dob, gender, email,
  blood_group, marital_status, occupation, relationship,
  spouse_name, spouse_age, alt_phone, isdcode,
  religion, id_proof, id_proof_details, family_id,
  address_street, address_area, address_landmark,
  address_city, address_state, address_zip, address_country,
  guardian_name, guardian_phone, guardian_address,
  specialty, doctor, branch,
}) {
  await pool.query(`
    INSERT INTO patient_profiles(
      phone, name, lname, title, phid, ext_phid, dob, gender, email,
      blood_group, marital_status, occupation, relationship,
      spouse_name, spouse_age, alt_phone, isdcode,
      religion, id_proof, id_proof_details, family_id,
      address_street, address_area, address_landmark,
      address_city, address_state, address_zip, address_country,
      guardian_name, guardian_phone, guardian_address,
      specialty, doctor, branch, last_contact
    ) VALUES(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,
      $10,$11,$12,$13,
      $14,$15,$16,$17,
      $18,$19,$20,$21,
      $22,$23,$24,
      $25,$26,$27,$28,
      $29,$30,$31,
      $32,$33,$34,NOW()
    )
    ON CONFLICT(phone) DO UPDATE SET
      name             = COALESCE(EXCLUDED.name,             patient_profiles.name),
      lname            = COALESCE(EXCLUDED.lname,            patient_profiles.lname),
      title            = COALESCE(EXCLUDED.title,            patient_profiles.title),
      phid             = COALESCE(EXCLUDED.phid,             patient_profiles.phid),
      ext_phid         = COALESCE(EXCLUDED.ext_phid,         patient_profiles.ext_phid),
      dob              = COALESCE(EXCLUDED.dob,              patient_profiles.dob),
      gender           = COALESCE(EXCLUDED.gender,           patient_profiles.gender),
      email            = COALESCE(EXCLUDED.email,            patient_profiles.email),
      blood_group      = COALESCE(EXCLUDED.blood_group,      patient_profiles.blood_group),
      marital_status   = COALESCE(EXCLUDED.marital_status,   patient_profiles.marital_status),
      occupation       = COALESCE(EXCLUDED.occupation,       patient_profiles.occupation),
      relationship     = COALESCE(EXCLUDED.relationship,     patient_profiles.relationship),
      spouse_name      = COALESCE(EXCLUDED.spouse_name,      patient_profiles.spouse_name),
      spouse_age       = COALESCE(EXCLUDED.spouse_age,       patient_profiles.spouse_age),
      alt_phone        = COALESCE(EXCLUDED.alt_phone,        patient_profiles.alt_phone),
      isdcode          = COALESCE(EXCLUDED.isdcode,          patient_profiles.isdcode),
      religion         = COALESCE(EXCLUDED.religion,         patient_profiles.religion),
      id_proof         = COALESCE(EXCLUDED.id_proof,         patient_profiles.id_proof),
      id_proof_details = COALESCE(EXCLUDED.id_proof_details, patient_profiles.id_proof_details),
      family_id        = COALESCE(EXCLUDED.family_id,        patient_profiles.family_id),
      address_street   = COALESCE(EXCLUDED.address_street,   patient_profiles.address_street),
      address_area     = COALESCE(EXCLUDED.address_area,     patient_profiles.address_area),
      address_landmark = COALESCE(EXCLUDED.address_landmark, patient_profiles.address_landmark),
      address_city     = COALESCE(EXCLUDED.address_city,     patient_profiles.address_city),
      address_state    = COALESCE(EXCLUDED.address_state,    patient_profiles.address_state),
      address_zip      = COALESCE(EXCLUDED.address_zip,      patient_profiles.address_zip),
      address_country  = COALESCE(EXCLUDED.address_country,  patient_profiles.address_country),
      guardian_name    = COALESCE(EXCLUDED.guardian_name,    patient_profiles.guardian_name),
      guardian_phone   = COALESCE(EXCLUDED.guardian_phone,   patient_profiles.guardian_phone),
      guardian_address = COALESCE(EXCLUDED.guardian_address, patient_profiles.guardian_address),
      specialty        = COALESCE(EXCLUDED.specialty,        patient_profiles.specialty),
      doctor           = COALESCE(EXCLUDED.doctor,           patient_profiles.doctor),
      last_contact     = NOW()
  `, [
    phone,
    name              || null,
    lname             || null,
    title             || null,
    phid              || null,
    ext_phid          || null,
    dob               || null,
    gender            || null,
    email             || null,
    blood_group       || null,
    marital_status    || null,
    occupation        || null,
    relationship      || null,
    spouse_name       || null,
    spouse_age        || null,
    alt_phone         || null,
    isdcode           || '91',
    religion          || null,
    id_proof          || null,
    id_proof_details  || null,
    family_id         || null,
    address_street    || null,
    address_area      || null,
    address_landmark  || null,
    address_city      || null,
    address_state     || null,
    address_zip       || null,
    address_country   || null,
    guardian_name     || null,
    guardian_phone    || null,
    guardian_address  || null,
    specialty         || null,
    doctor            || null,
    branch            || 'Ambattur',
  ]);
}

// ── Visits log (one row per checkin/checkout) ─────────────────────────────────
async function logVisit({
  phone, phid, opno, token, checkin_date, checkin_time,
  checkout_dt, checked_out_by, doctor, booked_doctor, specialty,
  nature_of_visit, entity_location, referred_by, created_by,
  follow_up_date, visit_status,
}) {
  await pool.query(`
    INSERT INTO visits(
      phone, phid, opno, token, checkin_date, checkin_time,
      checkout_dt, checked_out_by, doctor, booked_doctor, specialty,
      nature_of_visit, entity_location, referred_by, created_by,
      follow_up_date, visit_status
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
  `, [
    phone, phid||null, opno||null, token||null,
    checkin_date||null, checkin_time||null,
    checkout_dt||null, checked_out_by||null, doctor||null, booked_doctor||null, specialty||null,
    nature_of_visit||null, entity_location||null,
    referred_by||null, created_by||null,
    follow_up_date||null, visit_status||'checkin',
  ]).catch(() => {});
}

const getVisits = (phone) =>
  q('SELECT * FROM visits WHERE phone=$1 ORDER BY created_at DESC LIMIT 50', [phone]);

// ── Bills log (OP bill created / updated / cancelled) ─────────────────────────
async function logBill({
  bill_no, bill_date, phone, patient_name, consultant, saved_by, saved_at,
  payment_type, nature_of_visit, chief_complaint, referred_by, unregistered_dr,
  credit_provider, discount_amount, discount_percentage,
  amount_received, amount_payable, total_tax, location, items,
  event_type, event_by, event_reason,
}) {
  await pool.query(`
    INSERT INTO bills(
      bill_no, bill_date, phone, patient_name, consultant, saved_by, saved_at,
      payment_type, nature_of_visit, chief_complaint, referred_by, unregistered_dr,
      credit_provider, discount_amount, discount_percentage,
      amount_received, amount_payable, total_tax, location, items,
      event_type, event_by, event_reason
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
  `, [
    bill_no||null, bill_date||null, phone||null, patient_name||null,
    consultant||null, saved_by||null, saved_at||null,
    payment_type||null, nature_of_visit||null, chief_complaint||null,
    referred_by||null, unregistered_dr||null, credit_provider||null,
    discount_amount||null, discount_percentage||null,
    amount_received||null, amount_payable||null, total_tax||null,
    location||null, items ? JSON.stringify(items) : null,
    event_type||'created', event_by||null, event_reason||null,
  ]).catch(() => {});
}

const getBills = (billNo) =>
  q('SELECT * FROM bills WHERE bill_no=$1 ORDER BY created_at DESC', [billNo]);

const getRecentBills = (limit=200) =>
  q('SELECT * FROM bills ORDER BY created_at DESC LIMIT $1', [limit]);

async function getPatients({ specialty, doctor, search } = {}) {
  let sql = 'SELECT * FROM patient_profiles';
  const params = []; const conds = [];
  if (specialty) { params.push(specialty); conds.push(`specialty=$${params.length}`); }
  if (doctor)    { params.push(doctor);    conds.push(`doctor=$${params.length}`); }
  if (search)    { params.push(`%${search}%`); conds.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length})`); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY last_contact DESC LIMIT 500';
  return q(sql, params);
}

async function getBirthdaysToday() {
  // Returns patients whose birthday is today (ignoring year)
  return q(`
    SELECT * FROM patient_profiles
    WHERE dob IS NOT NULL
      AND TO_CHAR(dob,'MM-DD') = TO_CHAR(NOW(),'MM-DD')
      AND opt_in = TRUE
  `);
}

async function getBroadcastLists() {
  return q('SELECT * FROM broadcast_lists ORDER BY created_at DESC');
}

async function createBroadcastList({ name, description, phones }) {
  const res = await pool.query(
    'INSERT INTO broadcast_lists(name, description, phone_count) VALUES($1,$2,$3) RETURNING id',
    [name, description||null, phones.length]
  );
  const id = res.rows[0].id;
  for (const p of phones) {
    await pool.query(
      'INSERT INTO broadcast_list_members(list_id,phone) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [id, p]
    );
  }
  return id;
}

async function getBroadcastListMembers(listId) {
  const rows = await q(
    `SELECT blm.phone, pp.name FROM broadcast_list_members blm
     LEFT JOIN patient_profiles pp ON pp.phone=blm.phone
     WHERE blm.list_id=$1`, [listId]
  );
  return rows;
}

// Broadcast campaigns log
async function logBroadcast({ name, message, recipientCount, sent, failed }) {
  await pool.query(
    'INSERT INTO broadcast_campaigns(name,message,recipient_count,sent_count,failed_count) VALUES($1,$2,$3,$4,$5)',
    [name, message, recipientCount, sent, failed]
  );
}

async function getBroadcastHistory() {
  return q('SELECT * FROM broadcast_campaigns ORDER BY sent_at DESC LIMIT 50');
}

// ── Export all ───────────────────────────────────────────────────────────────
// ── DPDP Consent tracking ─────────────────────────────────────────────────────
// Called on first WhatsApp send — records implicit opt-in for DPDP compliance
async function recordConsent({ phone, patientName, triggerType }) {
  try {
    await pool.query(`
      INSERT INTO consent_log(phone, patient_name, consent_type, trigger_type)
      VALUES($1, $2, 'implicit_whatsapp', $3)
      ON CONFLICT(phone) DO NOTHING
    `, [phone, patientName || null, triggerType || null]);
  } catch (e) {
    // Non-fatal — log and continue
    console.error('[consent] error:', e.message);
  }
}

async function hasConsent(phone) {
  const row = await q1('SELECT id FROM consent_log WHERE phone=$1', [phone]);
  return !!row;
}

// ── Message delivery tracking ─────────────────────────────────────────────────
// Called by Meta delivery webhook handler
async function updateDeliveryStatus({ waMessageId, phone, status, errorCode, errorMsg }) {
  try {
    await pool.query(`
      INSERT INTO message_delivery(wa_message_id, phone, status, error_code, error_msg, updated_at)
      VALUES($1, $2, $3, $4, $5, NOW())
      ON CONFLICT(wa_message_id) DO UPDATE SET
        status     = EXCLUDED.status,
        error_code = EXCLUDED.error_code,
        error_msg  = EXCLUDED.error_msg,
        updated_at = NOW()
    `, [waMessageId, phone, status, errorCode || null, errorMsg || null]);

    // Sync status to outbound_messages for dashboard display
    await pool.query(`
      UPDATE outbound_messages
      SET delivery_status = $1
      WHERE wa_message_id = $2
    `, [status, waMessageId]);
  } catch (e) {
    console.error('[delivery] error:', e.message);
  }
}

async function getDeliveryStats() {
  const rows = await q(`
    SELECT
      status,
      COUNT(*) AS count
    FROM message_delivery
    WHERE updated_at >= NOW() - INTERVAL '7 days'
    GROUP BY status
    ORDER BY count DESC
  `);
  return rows;
}

// ── Webhook rate limiting (in-memory, per IP) ─────────────────────────────────
const webhookHits = new Map();
function checkWebhookRateLimit(ip, maxPerMinute = 60) {
  const now  = Date.now();
  const key  = ip;
  const data = webhookHits.get(key) || { count: 0, resetAt: now + 60000 };

  if (now > data.resetAt) {
    data.count   = 0;
    data.resetAt = now + 60000;
  }

  data.count++;
  webhookHits.set(key, data);

  return data.count <= maxPerMinute;
}

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of webhookHits.entries()) {
    if (now > data.resetAt + 120000) webhookHits.delete(key);
  }
}, 5 * 60 * 1000);

