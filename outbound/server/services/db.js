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

    -- Dialer: ref_id for upserting call-attempt → completion updates (Exotel CallSid)
    ALTER TABLE dialer_calls ADD COLUMN IF NOT EXISTS ref_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_calls_ref ON dialer_calls(ref_id);

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

    -- Outbound messages: add wa_message_id column for delivery tracking,
    -- and broadcast_id to trace an individual message back to the campaign
    -- (if any) that triggered it.
    ALTER TABLE outbound_messages
      ADD COLUMN IF NOT EXISTS wa_message_id TEXT,
      ADD COLUMN IF NOT EXISTS broadcast_id INTEGER REFERENCES broadcast_campaigns(id),
      ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'sent',
      ADD COLUMN IF NOT EXISTS consent_recorded BOOLEAN DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS idx_om_broadcast ON outbound_messages(broadcast_id);

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

    -- ════════════════════════════════════════════════════════════════════════
    -- DATABASE OPTIMISATION PASS — master tables, patient_id linkage,
    -- audit columns, audit log, and documentation comments.
    -- All statements below are additive/idempotent (IF NOT EXISTS / ON
    -- CONFLICT DO NOTHING) and safe to re-run on every startup.
    -- ════════════════════════════════════════════════════════════════════════

    -- ── Master reference tables ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS specialties (
      id          SERIAL PRIMARY KEY,
      name        TEXT UNIQUE NOT NULL,
      created_by  TEXT DEFAULT 'system',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_by  TEXT DEFAULT 'system',
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS doctors (
      id            SERIAL PRIMARY KEY,
      name          TEXT UNIQUE NOT NULL,
      specialty_id  INTEGER REFERENCES specialties(id),
      created_by    TEXT DEFAULT 'system',
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_by    TEXT DEFAULT 'system',
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );

    -- ── Audit log ─────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS audit_log (
      id           SERIAL PRIMARY KEY,
      actor        TEXT NOT NULL DEFAULT 'system',
      action       TEXT NOT NULL,
      entity       TEXT NOT NULL,
      entity_id    TEXT,
      before_value JSONB,
      after_value  JSONB,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_log(actor, created_at DESC);

    -- ── patient_profiles: surrogate key already exists (id) — add doctor/specialty FKs
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS doctor_id    INTEGER REFERENCES doctors(id);
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS specialty_id INTEGER REFERENCES specialties(id);
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS created_by   TEXT DEFAULT 'system';
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS updated_by   TEXT DEFAULT 'system';
    ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();

    -- ── dialer_calls: link to patient once identified, audit columns ─────────
    ALTER TABLE dialer_calls ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patient_profiles(id);
    ALTER TABLE dialer_calls ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'dialer-webhook';
    ALTER TABLE dialer_calls ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT 'dialer-webhook';
    ALTER TABLE dialer_calls ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    CREATE INDEX IF NOT EXISTS idx_calls_patient ON dialer_calls(patient_id);

    -- ── callback_queue: audit columns (phone/caller_name removed below — derive via call_id join)
    ALTER TABLE callback_queue ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'dialer-webhook';
    ALTER TABLE callback_queue ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT 'system';
    ALTER TABLE callback_queue ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

    -- ── outbound_messages: link to patient (patient_name removed below) ──────
    ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patient_profiles(id);
    ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'system';
    ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT 'system';
    ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    CREATE INDEX IF NOT EXISTS idx_om_patient ON outbound_messages(patient_id);

    -- ── consent_log: link to patient (patient_name removed below) ────────────
    ALTER TABLE consent_log ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patient_profiles(id);
    ALTER TABLE consent_log ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'system';
    ALTER TABLE consent_log ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT 'system';
    ALTER TABLE consent_log ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    CREATE INDEX IF NOT EXISTS idx_consent_patient ON consent_log(patient_id);

    -- ── message_delivery: link to patient, audit columns ──────────────────────
    ALTER TABLE message_delivery ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patient_profiles(id);
    ALTER TABLE message_delivery ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'system';
    ALTER TABLE message_delivery ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE message_delivery ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT 'system';

    -- ── recall_schedule: link to patient + specialty, audit columns ──────────
    ALTER TABLE recall_schedule ADD COLUMN IF NOT EXISTS patient_id   INTEGER REFERENCES patient_profiles(id);
    ALTER TABLE recall_schedule ADD COLUMN IF NOT EXISTS specialty_id INTEGER REFERENCES specialties(id);
    ALTER TABLE recall_schedule ADD COLUMN IF NOT EXISTS created_by   TEXT DEFAULT 'scheduler';
    ALTER TABLE recall_schedule ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE recall_schedule ADD COLUMN IF NOT EXISTS updated_by   TEXT DEFAULT 'scheduler';
    ALTER TABLE recall_schedule ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();
    CREATE INDEX IF NOT EXISTS idx_recall_patient ON recall_schedule(patient_id);

    -- ── follow_up_queue: link to patient + doctor + specialty, audit columns ─
    ALTER TABLE follow_up_queue ADD COLUMN IF NOT EXISTS patient_id   INTEGER REFERENCES patient_profiles(id);
    ALTER TABLE follow_up_queue ADD COLUMN IF NOT EXISTS doctor_id    INTEGER REFERENCES doctors(id);
    ALTER TABLE follow_up_queue ADD COLUMN IF NOT EXISTS specialty_id INTEGER REFERENCES specialties(id);
    ALTER TABLE follow_up_queue ADD COLUMN IF NOT EXISTS created_by   TEXT DEFAULT 'scheduler';
    ALTER TABLE follow_up_queue ADD COLUMN IF NOT EXISTS updated_by   TEXT DEFAULT 'scheduler';
    ALTER TABLE follow_up_queue ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();
    CREATE INDEX IF NOT EXISTS idx_fuq_patient ON follow_up_queue(patient_id);

    -- ── visits: link to patient + doctor + specialty, audit columns ──────────
    ALTER TABLE visits ADD COLUMN IF NOT EXISTS patient_id   INTEGER REFERENCES patient_profiles(id);
    ALTER TABLE visits ADD COLUMN IF NOT EXISTS doctor_id    INTEGER REFERENCES doctors(id);
    ALTER TABLE visits ADD COLUMN IF NOT EXISTS specialty_id INTEGER REFERENCES specialties(id);
    ALTER TABLE visits ADD COLUMN IF NOT EXISTS updated_by   TEXT DEFAULT 'mocdoc-webhook';
    ALTER TABLE visits ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();
    CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id);

    -- ── bills: link to patient + doctor, audit columns ────────────────────────
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patient_profiles(id);
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS doctor_id  INTEGER REFERENCES doctors(id);
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'mocdoc-webhook';
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT 'mocdoc-webhook';
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    CREATE INDEX IF NOT EXISTS idx_bills_patient ON bills(patient_id);

    -- ── broadcast_lists / members / campaigns: audit columns + patient link ──
    ALTER TABLE broadcast_lists ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'system';
    ALTER TABLE broadcast_lists ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT 'system';
    ALTER TABLE broadcast_lists ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

    ALTER TABLE broadcast_list_members ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patient_profiles(id);
    ALTER TABLE broadcast_list_members ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'system';
    ALTER TABLE broadcast_list_members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

    ALTER TABLE broadcast_campaigns ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'system';

    -- ── engagement_log: audit column ──────────────────────────────────────────
    ALTER TABLE engagement_log ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'system';

    -- ════════════════════════════════════════════════════════════════════════
    -- BACKFILL — populate new FK columns from existing data (one-time, idempotent)
    -- ════════════════════════════════════════════════════════════════════════

    -- patient_id from phone (single source of truth = patient_profiles)
    UPDATE dialer_calls dc        SET patient_id = pp.id FROM patient_profiles pp WHERE dc.phone = pp.phone AND dc.patient_id IS NULL;
    UPDATE outbound_messages om   SET patient_id = pp.id FROM patient_profiles pp WHERE om.phone = pp.phone AND om.patient_id IS NULL;
    UPDATE consent_log cl         SET patient_id = pp.id FROM patient_profiles pp WHERE cl.phone = pp.phone AND cl.patient_id IS NULL;
    UPDATE message_delivery md     SET patient_id = pp.id FROM patient_profiles pp WHERE md.phone = pp.phone AND md.patient_id IS NULL;
    UPDATE recall_schedule rs      SET patient_id = pp.id FROM patient_profiles pp WHERE rs.phone = pp.phone AND rs.patient_id IS NULL;
    UPDATE follow_up_queue fq      SET patient_id = pp.id FROM patient_profiles pp WHERE fq.phone = pp.phone AND fq.patient_id IS NULL;
    UPDATE visits v                SET patient_id = pp.id FROM patient_profiles pp WHERE v.phone = pp.phone AND v.patient_id IS NULL;
    UPDATE bills b                 SET patient_id = pp.id FROM patient_profiles pp WHERE b.phone = pp.phone AND b.patient_id IS NULL AND b.phone IS NOT NULL AND b.phone <> '';
    UPDATE broadcast_list_members blm SET patient_id = pp.id FROM patient_profiles pp WHERE blm.phone = pp.phone AND blm.patient_id IS NULL;

    -- specialties — seed from every place a specialty name currently appears as free text
    INSERT INTO specialties(name)
    SELECT DISTINCT t.specialty FROM (
      SELECT specialty FROM patient_profiles  WHERE specialty IS NOT NULL AND specialty <> ''
      UNION SELECT specialty FROM visits      WHERE specialty IS NOT NULL AND specialty <> ''
      UNION SELECT specialty FROM recall_schedule WHERE specialty IS NOT NULL AND specialty <> ''
      UNION SELECT specialty FROM follow_up_queue WHERE specialty IS NOT NULL AND specialty <> ''
    ) t
    ON CONFLICT (name) DO NOTHING;

    -- doctors — seed from every place a doctor name currently appears as free text
    INSERT INTO doctors(name)
    SELECT DISTINCT t.doctor FROM (
      SELECT doctor FROM patient_profiles  WHERE doctor IS NOT NULL AND doctor <> ''
      UNION SELECT doctor FROM visits      WHERE doctor IS NOT NULL AND doctor <> ''
      UNION SELECT booked_doctor AS doctor FROM visits WHERE booked_doctor IS NOT NULL AND booked_doctor <> ''
      UNION SELECT doctor FROM follow_up_queue WHERE doctor IS NOT NULL AND doctor <> ''
      UNION SELECT consultant AS doctor FROM bills WHERE consultant IS NOT NULL AND consultant <> ''
    ) t
    ON CONFLICT (name) DO NOTHING;

    -- Link doctors to a specialty where inferable from patient_profiles
    UPDATE doctors dd SET specialty_id = sp.id
    FROM patient_profiles pp JOIN specialties sp ON sp.name = pp.specialty
    WHERE dd.name = pp.doctor AND dd.specialty_id IS NULL AND pp.specialty IS NOT NULL AND pp.specialty <> '';

    -- Backfill doctor_id / specialty_id FKs from the matching master record
    UPDATE visits v          SET doctor_id    = d.id FROM doctors d     WHERE v.doctor = d.name AND v.doctor_id IS NULL;
    UPDATE visits v          SET specialty_id = s.id FROM specialties s WHERE v.specialty = s.name AND v.specialty_id IS NULL;
    UPDATE bills b            SET doctor_id    = d.id FROM doctors d     WHERE b.consultant = d.name AND b.doctor_id IS NULL;
    UPDATE follow_up_queue f  SET doctor_id    = d.id FROM doctors d     WHERE f.doctor = d.name AND f.doctor_id IS NULL;
    UPDATE follow_up_queue f  SET specialty_id = s.id FROM specialties s WHERE f.specialty = s.name AND f.specialty_id IS NULL;
    UPDATE recall_schedule r  SET specialty_id = s.id FROM specialties s WHERE r.specialty = s.name AND r.specialty_id IS NULL;
    UPDATE patient_profiles p SET doctor_id    = d.id FROM doctors d     WHERE p.doctor = d.name AND p.doctor_id IS NULL;
    UPDATE patient_profiles p SET specialty_id = s.id FROM specialties s WHERE p.specialty = s.name AND p.specialty_id IS NULL;

    -- ════════════════════════════════════════════════════════════════════════
    -- REMOVE DUPLICATE COLUMNS — superseded by patient_id / call_id joins.
    -- Query functions below preserve the same field names via aliased joins,
    -- so no other file needs to change.
    -- ════════════════════════════════════════════════════════════════════════
    ALTER TABLE callback_queue    DROP COLUMN IF EXISTS phone;
    ALTER TABLE callback_queue    DROP COLUMN IF EXISTS caller_name;
    ALTER TABLE broadcast_lists   DROP COLUMN IF EXISTS phone_count;
    ALTER TABLE outbound_messages DROP COLUMN IF EXISTS patient_name;
    ALTER TABLE consent_log       DROP COLUMN IF EXISTS patient_name;

    -- ════════════════════════════════════════════════════════════════════════
    -- DOCUMENTATION — table comments so anyone browsing the database (psql,
    -- pgAdmin, DBeaver, TablePlus) can see what each table is for.
    -- ════════════════════════════════════════════════════════════════════════
    COMMENT ON TABLE patient_profiles    IS 'MASTER TABLE for patient identity. Single source of truth for phone number and name — every other table links here via patient_id instead of repeating phone/name. Holds full MocDoc demographics (DOB, address, guardian, etc.) for personalised WhatsApp messages.';
    COMMENT ON TABLE doctors             IS 'Master list of doctors. Referenced via doctor_id from visits, bills, follow_up_queue and patient_profiles, since one patient may see multiple doctors over time.';
    COMMENT ON TABLE specialties         IS 'Master list of medical specialties (e.g. Dentistry, Orthopaedics). Referenced via specialty_id from doctors, visits, bills, recall_schedule, follow_up_queue and patient_profiles.';
    COMMENT ON TABLE visits              IS 'One row per check-in / check-in-update / check-out / appointment event from MocDoc. Linked to patient_profiles via patient_id, and to doctors/specialties via doctor_id/specialty_id.';
    COMMENT ON TABLE bills                IS 'OP bill created / updated / cancelled events from MocDoc, including the full line-item breakdown (items JSONB). Linked to patient_profiles via patient_id when the bill payload includes a phone number (MocDoc often omits it).';
    COMMENT ON TABLE dialer_calls         IS 'Every inbound call event from the PBX/Exotel webhook (including call-attempt-only events on trial accounts, logged with status=received). Linked to patient_profiles via patient_id once the caller is identified; caller_name retains the raw, possibly-unverified name given by the caller.';
    COMMENT ON TABLE callback_queue       IS 'Queue of calls awaiting a staff callback (status=missed or received on dialer_calls). phone/caller_name are NOT stored here — join to dialer_calls via call_id (and to patient_profiles via dialer_calls.patient_id) to get them.';
    COMMENT ON TABLE outbound_messages    IS 'WhatsApp message history (one row per message sent) for the dashboard chat-history view. Linked to patient_profiles via patient_id — patient name is looked up via that join, not duplicated here.';
    COMMENT ON COLUMN outbound_messages.broadcast_id IS 'Set when this message was sent as part of a broadcast campaign — references broadcast_campaigns(id). NULL for automated trigger messages (reminders, recalls, etc.).';
    COMMENT ON TABLE consent_log          IS 'DPDP Act consent record — one row per patient phone number, written on first WhatsApp contact (implicit opt-in). Linked to patient_profiles via patient_id; patient name is looked up via that join, not duplicated here.';
    COMMENT ON TABLE message_delivery     IS 'Per-message WhatsApp delivery status (sent/delivered/read/failed) reported by Meta''s delivery webhook, keyed by wa_message_id. Linked to patient_profiles via patient_id.';
    COMMENT ON TABLE engagement_log       IS 'Dedup guard: records every automated message trigger fired for a phone number, so the same trigger_type is not sent twice within the configured window.';
    COMMENT ON TABLE recall_schedule      IS '30/60/90-day recall reminders to be sent on recall_at. Linked to patient_profiles via patient_id and to specialties via specialty_id.';
    COMMENT ON TABLE follow_up_queue      IS 'No-show / missed-appointment recovery queue. Linked to patient_profiles via patient_id, and to doctors/specialties via doctor_id/specialty_id.';
    COMMENT ON TABLE broadcast_lists      IS 'Saved patient segments for broadcast campaigns. Member count is derived from broadcast_list_members, not stored as a column.';
    COMMENT ON TABLE broadcast_list_members IS 'Members of a broadcast_lists segment. Linked to patient_profiles via patient_id where the phone number matches an existing patient.';
    COMMENT ON TABLE broadcast_campaigns  IS 'History of broadcast sends: campaign name, message text, and recipient/sent/failed counts.';
    COMMENT ON TABLE audit_log            IS 'Application audit trail — records who (actor) did what (action) to which record (entity/entity_id) and when, including staff logins, login failures, and master-table (doctors/specialties/broadcast_lists) changes.';

    COMMENT ON COLUMN patient_profiles.id         IS 'Surrogate primary key (patient_id) referenced by every other table. Stable even if the patient''s phone number changes.';
    COMMENT ON COLUMN patient_profiles.phone      IS 'Current WhatsApp/contact number. Update this single column if a patient changes their number — all linked tables remain valid via patient_id.';
    COMMENT ON COLUMN dialer_calls.caller_name    IS 'Name as given by the inbound caller — may be unverified and may not match patient_profiles.name. Once matched, patient_id is set and patient_profiles.name is the verified name.';
    COMMENT ON COLUMN dialer_calls.patient_id     IS 'Set only if the calling number matches an existing patient_profiles row. A new/unknown caller does NOT create a patient_profiles row.';

  `);
  console.log('[db] Schema ready');
}


// ── Normalisation helpers ────────────────────────────────────────────────────
// Look up the master patient_id for a phone number. Returns null if no
// patient_profiles row exists yet (e.g. a brand-new caller).
async function resolvePatientId(phone) {
  if (!phone) return null;
  const row = await q1('SELECT id FROM patient_profiles WHERE phone=$1', [phone]);
  return row ? row.id : null;
}

// Get-or-create a specialty by name, returning its id. Returns null for empty input.
async function resolveSpecialtyId(name, actor='system') {
  if (!name) return null;
  const row = await q1(`
    INSERT INTO specialties(name, created_by, updated_by) VALUES($1,$2,$2)
    ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name
    RETURNING id
  `, [name, actor]);
  return row ? row.id : null;
}

// Get-or-create a doctor by name (optionally linking a specialty), returning its id.
async function resolveDoctorId(name, specialtyName=null, actor='system') {
  if (!name) return null;
  const specialtyId = specialtyName ? await resolveSpecialtyId(specialtyName, actor) : null;
  const row = await q1(`
    INSERT INTO doctors(name, specialty_id, created_by, updated_by)
    VALUES($1,$2,$3,$3)
    ON CONFLICT(name) DO UPDATE SET
      specialty_id = COALESCE(EXCLUDED.specialty_id, doctors.specialty_id)
    RETURNING id
  `, [name, specialtyId, actor]);
  return row ? row.id : null;
}

const getDoctors = () =>
  q(`SELECT d.*, s.name AS specialty_name FROM doctors d
     LEFT JOIN specialties s ON s.id=d.specialty_id ORDER BY d.name`);

const getSpecialties = () =>
  q('SELECT * FROM specialties ORDER BY name');

// ── Audit log ─────────────────────────────────────────────────────────────────
async function logAudit({ actor, action, entity, entityId, before=null, after=null }) {
  await pool.query(
    `INSERT INTO audit_log(actor, action, entity, entity_id, before_value, after_value)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [actor||'system', action, entity, entityId!=null?String(entityId):null,
     before?JSON.stringify(before):null, after?JSON.stringify(after):null]
  ).catch(e => console.error('[audit] error:', e.message));
}

const getAuditLog = (limit=200, entity=null) => entity
  ? q('SELECT * FROM audit_log WHERE entity=$1 ORDER BY created_at DESC LIMIT $2', [entity, limit])
  : q('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1', [limit]);

// ── Engagement ────────────────────────────────────────────────────────────────
const alreadySent = async (phone, type, hrs=24) =>
  !!(await q1(`SELECT id FROM engagement_log WHERE phone=$1 AND trigger_type=$2 AND sent_at>NOW()-($3||' hours')::INTERVAL LIMIT 1`,[phone,type,hrs]));

const logSent = (phone, type, refId=null) =>
  pool.query('INSERT INTO engagement_log(phone,trigger_type,ref_id) VALUES($1,$2,$3)',[phone,type,String(refId||'')]);

// ── Recall ────────────────────────────────────────────────────────────────────
async function scheduleRecall({phone,name,specialty,daysFromNow}) {
  const patientId   = await resolvePatientId(phone);
  const specialtyId = specialty ? await resolveSpecialtyId(specialty, 'scheduler') : null;
  return pool.query(
    `INSERT INTO recall_schedule(phone,name,specialty,recall_at,recall_days,patient_id,specialty_id)
     VALUES($1,$2,$3,NOW()+($4||' days')::INTERVAL,$4,$5,$6)`,
    [phone,name,specialty,daysFromNow,patientId,specialtyId]
  ).catch(()=>{});
}

const getDueRecalls = () =>
  q("SELECT * FROM recall_schedule WHERE status='pending' AND recall_at<=NOW()");

// All pending recalls (including ones not yet due) — for the dashboard view
const getPendingRecalls = () =>
  q("SELECT * FROM recall_schedule WHERE status='pending' ORDER BY recall_at ASC");

const markRecallSent = id =>
  pool.query("UPDATE recall_schedule SET status='sent' WHERE id=$1",[id]);

// ── Follow-up queue ───────────────────────────────────────────────────────────
async function addNoShow({phone,name,doctor,specialty,originalDt}) {
  const patientId   = await resolvePatientId(phone);
  const doctorId    = doctor    ? await resolveDoctorId(doctor, specialty, 'scheduler') : null;
  const specialtyId = specialty ? await resolveSpecialtyId(specialty, 'scheduler')       : null;
  return pool.query(
    `INSERT INTO follow_up_queue(phone,name,doctor,specialty,original_dt,patient_id,doctor_id,specialty_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [phone,name,doctor,specialty,originalDt,patientId,doctorId,specialtyId]
  );
}

const getPendingNoShows = () =>
  q("SELECT * FROM follow_up_queue WHERE status='pending' ORDER BY created_at DESC");

const markNoShowRecovered = id =>
  pool.query("UPDATE follow_up_queue SET status='recovered' WHERE id=$1",[id]);

// ── Dialer ────────────────────────────────────────────────────────────────────
async function logCall({phone, callerName, durationSec, status, agent, notes, refId}) {
  let id;

  // Link to an existing patient record if this number is already a known patient.
  // A brand-new/unrecognised caller does NOT create a patient_profiles row —
  // patient_id simply stays null until/unless they're already registered.
  const patientId = await resolvePatientId(phone);

  // If we have a ref_id (e.g. Exotel CallSid) and a row already exists for it,
  // update that row in place rather than inserting a duplicate — this lets the
  // initial "call-attempt" event (incoming call received) get upgraded by a
  // later completion event (answered/missed) for the same call.
  if (refId) {
    const existing = await pool.query(
      'SELECT id FROM dialer_calls WHERE ref_id=$1 ORDER BY id DESC LIMIT 1',
      [refId]
    );
    if (existing.rows.length) {
      id = existing.rows[0].id;
      await pool.query(
        `UPDATE dialer_calls SET
           status       = $1,
           duration_sec = COALESCE($2, duration_sec),
           agent        = COALESCE($3, agent),
           notes        = COALESCE($4, notes),
           caller_name  = COALESCE($5, caller_name),
           patient_id   = COALESCE($6, patient_id),
           updated_at   = NOW()
         WHERE id=$7`,
        [status, durationSec||null, agent||null, notes||null, callerName||null, patientId, id]
      );
    }
  }

  if (!id) {
    const res = await pool.query(
      'INSERT INTO dialer_calls(phone,caller_name,duration_sec,status,agent,notes,ref_id,patient_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [phone, callerName||null, durationSec||null, status, agent||null, notes||null, refId||null, patientId]
    );
    id = res.rows[0].id;
  }

  // Queue a callback for any call that wasn't answered — this includes
  // 'missed' (explicit) and 'received' (incoming call logged on a trial
  // Exotel account where the Connect leg never completes, so the patient
  // effectively got no response and needs a human callback).
  if (status === 'missed' || status === 'received') {
    const already = await pool.query(
      'SELECT id FROM callback_queue WHERE call_id=$1',
      [id]
    );
    if (!already.rows.length) {
      await pool.query(
        'INSERT INTO callback_queue(call_id) VALUES($1)',
        [id]
      );
    }
  }

  return id;
}

const getCalls = (limit=100) =>
  q('SELECT * FROM dialer_calls ORDER BY called_at DESC LIMIT $1',[limit]);

const getCallbackQueue = () =>
  q(`
    SELECT cq.id, cq.call_id, cq.missed_at, cq.status,
           dc.phone,
           COALESCE(pp.name, dc.caller_name) AS caller_name,
           dc.patient_id
    FROM callback_queue cq
    JOIN dialer_calls dc       ON dc.id = cq.call_id
    LEFT JOIN patient_profiles pp ON pp.id = dc.patient_id
    WHERE cq.status='pending'
    ORDER BY cq.missed_at ASC
  `);

const markCallbackDone = (id, status='called_back') =>
  pool.query('UPDATE callback_queue SET status=$1 WHERE id=$2',[status,id]);

const getDialerStats = async () => {
  const today = new Date(); today.setHours(0,0,0,0);
  const [total,missed,answered,avgDur] = await Promise.all([
    q1('SELECT COUNT(*) AS n FROM dialer_calls WHERE called_at>=NOW()-INTERVAL \'7 days\''),
    q1("SELECT COUNT(*) AS n FROM dialer_calls WHERE status IN ('missed','received') AND called_at>=NOW()-INTERVAL '7 days'"),
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

// ── Outbound message log (WhatsApp chat history per patient) ──────────────────
// Every outbound message is stored here for the history view
async function logOutboundMessage({ phone, patientName, triggerType, message, broadcastId }) {
  const patientId = await resolvePatientId(phone);
  await pool.query(
    `INSERT INTO outbound_messages(phone, patient_id, trigger_type, message, broadcast_id)
     VALUES($1,$2,$3,$4,$5)`,
    [phone, patientId, triggerType, message, broadcastId || null]
  );
  // patientName is kept as a parameter for callers that pass it (used elsewhere
  // to upsert patient_profiles) — it is no longer stored on this row directly,
  // since outbound_messages.patient_id -> patient_profiles.name is now the
  // single source of truth for the patient's display name.
  //
  // broadcastId links this message back to broadcast_campaigns(id) when it
  // was sent as part of a broadcast — null for automated trigger messages.
}

async function getOutboundHistory({ phone, date, limit } = {}) {
  let sql = `
    SELECT om.*, pp.name AS patient_name
    FROM outbound_messages om
    LEFT JOIN patient_profiles pp ON pp.id = om.patient_id
  `;
  const params = [];
  const conds  = [];
  if (phone) { params.push(phone); conds.push(`om.phone=$${params.length}`); }
  if (date)  { params.push(date);  conds.push(`DATE(om.sent_at)=$${params.length}`); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY om.sent_at DESC';
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
  return q(`
    SELECT om.*, pp.name AS patient_name
    FROM outbound_messages om
    LEFT JOIN patient_profiles pp ON pp.id = om.patient_id
    WHERE om.phone=$1 ORDER BY om.sent_at DESC LIMIT 100
  `, [phone]);
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
      updated_at       = NOW(),
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

  const row = await q1('SELECT id FROM patient_profiles WHERE phone=$1', [phone]);
  const patientId = row ? row.id : null;

  // Resolve doctor / specialty master records and link them (additive —
  // doctor/specialty text columns above are kept for backward compatibility)
  if (patientId && (doctor || specialty)) {
    const doctorId    = doctor    ? await resolveDoctorId(doctor, specialty, 'mocdoc-webhook') : null;
    const specialtyId = specialty ? await resolveSpecialtyId(specialty, 'mocdoc-webhook')       : null;
    if (doctorId || specialtyId) {
      await pool.query(
        `UPDATE patient_profiles SET
           doctor_id    = COALESCE($1, doctor_id),
           specialty_id = COALESCE($2, specialty_id)
         WHERE id=$3`,
        [doctorId, specialtyId, patientId]
      );
    }
  }

  return patientId;
}

// ── Visits log (one row per checkin/checkout) ─────────────────────────────────
async function logVisit({
  phone, phid, opno, token, checkin_date, checkin_time,
  checkout_dt, checked_out_by, doctor, booked_doctor, specialty,
  nature_of_visit, entity_location, referred_by, created_by,
  follow_up_date, visit_status,
}) {
  const patientId  = await resolvePatientId(phone);
  const doctorId   = doctor    ? await resolveDoctorId(doctor, specialty, 'mocdoc-webhook') : null;
  const specialtyId= specialty ? await resolveSpecialtyId(specialty, 'mocdoc-webhook')       : null;

  await pool.query(`
    INSERT INTO visits(
      phone, phid, opno, token, checkin_date, checkin_time,
      checkout_dt, checked_out_by, doctor, booked_doctor, specialty,
      nature_of_visit, entity_location, referred_by, created_by,
      follow_up_date, visit_status, patient_id, doctor_id, specialty_id
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
  `, [
    phone, phid||null, opno||null, token||null,
    checkin_date||null, checkin_time||null,
    checkout_dt||null, checked_out_by||null, doctor||null, booked_doctor||null, specialty||null,
    nature_of_visit||null, entity_location||null,
    referred_by||null, created_by||'mocdoc-webhook',
    follow_up_date||null, visit_status||'checkin',
    patientId, doctorId, specialtyId,
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
  // OP bill payloads from MocDoc usually have no phone — patient_id/doctor_id
  // are populated when we *can* identify them, but patient_name and phone
  // are kept on this table since they're often the only identifiers available.
  const patientId = phone ? await resolvePatientId(phone) : null;
  const doctorId  = consultant ? await resolveDoctorId(consultant, null, event_by||'mocdoc-webhook') : null;

  await pool.query(`
    INSERT INTO bills(
      bill_no, bill_date, phone, patient_name, consultant, saved_by, saved_at,
      payment_type, nature_of_visit, chief_complaint, referred_by, unregistered_dr,
      credit_provider, discount_amount, discount_percentage,
      amount_received, amount_payable, total_tax, location, items,
      event_type, event_by, event_reason, patient_id, doctor_id, created_by
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
  `, [
    bill_no||null, bill_date||null, phone||null, patient_name||null,
    consultant||null, saved_by||null, saved_at||null,
    payment_type||null, nature_of_visit||null, chief_complaint||null,
    referred_by||null, unregistered_dr||null, credit_provider||null,
    discount_amount||null, discount_percentage||null,
    amount_received||null, amount_payable||null, total_tax||null,
    location||null, items ? JSON.stringify(items) : null,
    event_type||'created', event_by||null, event_reason||null,
    patientId, doctorId, event_by||'mocdoc-webhook',
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
  // phone_count is derived from broadcast_list_members rather than stored,
  // but aliased to the same field name for frontend compatibility.
  return q(`
    SELECT bl.*,
           (SELECT COUNT(*) FROM broadcast_list_members blm WHERE blm.list_id=bl.id) AS phone_count
    FROM broadcast_lists bl
    ORDER BY bl.created_at DESC
  `);
}

async function createBroadcastList({ name, description, phones }) {
  const res = await pool.query(
    'INSERT INTO broadcast_lists(name, description) VALUES($1,$2) RETURNING id',
    [name, description||null]
  );
  const id = res.rows[0].id;
  for (const p of phones) {
    const patientId = await resolvePatientId(p);
    await pool.query(
      'INSERT INTO broadcast_list_members(list_id,phone,patient_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [id, p, patientId]
    );
  }
  await logAudit({ actor: 'system', action: 'create', entity: 'broadcast_lists', entityId: id,
    after: { name, description, member_count: phones.length } });
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

// Create the campaign row BEFORE sending, so its id can be stamped onto each
// individual outbound_messages row as broadcast_id (traceability: which
// messages belong to which campaign).
async function createBroadcastCampaign({ name, message, recipientCount, actor='system' }) {
  const row = await q1(
    `INSERT INTO broadcast_campaigns(name,message,recipient_count,sent_count,failed_count)
     VALUES($1,$2,$3,0,0) RETURNING id`,
    [name, message, recipientCount]
  );
  await logAudit({ actor, action: 'create', entity: 'broadcast_campaigns', entityId: row.id,
    after: { name, message, recipient_count: recipientCount } });
  return row.id;
}

// Update sent/failed counts once the send loop has finished.
const updateBroadcastCounts = (id, sent, failed) =>
  pool.query(
    'UPDATE broadcast_campaigns SET sent_count=$2, failed_count=$3 WHERE id=$1',
    [id, sent, failed]
  );

async function getBroadcastHistory() {
  return q('SELECT * FROM broadcast_campaigns ORDER BY sent_at DESC LIMIT 50');
}

// Individual messages sent as part of a given campaign (drill-down).
const getBroadcastMessages = (broadcastId) =>
  q(`
    SELECT om.*, pp.name AS patient_name
    FROM outbound_messages om
    LEFT JOIN patient_profiles pp ON pp.id = om.patient_id
    WHERE om.broadcast_id = $1
    ORDER BY om.sent_at DESC
  `, [broadcastId]);

// ── Export all ───────────────────────────────────────────────────────────────
// ── DPDP Consent tracking ─────────────────────────────────────────────────────
// Called on first WhatsApp send — records implicit opt-in for DPDP compliance
async function recordConsent({ phone, patientName, triggerType }) {
  try {
    const patientId = await resolvePatientId(phone);
    // patientName is accepted for interface compatibility but no longer stored —
    // consent_log.patient_id -> patient_profiles.name is the single source of truth.
    await pool.query(`
      INSERT INTO consent_log(phone, patient_id, consent_type, trigger_type)
      VALUES($1, $2, 'implicit_whatsapp', $3)
      ON CONFLICT(phone) DO UPDATE SET patient_id = COALESCE(EXCLUDED.patient_id, consent_log.patient_id)
    `, [phone, patientId, triggerType || null]);
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

module.exports = {
  pool,  // exported for direct query access in whatsapp.js
  alreadySent, logSent,
  scheduleRecall, getDueRecalls, getPendingRecalls, markRecallSent,
  addNoShow, getPendingNoShows, markNoShowRecovered,
  logCall, getCalls, getCallbackQueue, markCallbackDone, getDialerStats,
  listState,
  logOutboundMessage, getOutboundHistory, getOutboundByDate, getPatientMessageHistory,
  upsertPatient, logVisit, getVisits, getPatients, getBirthdaysToday,
  logBill, getBills, getRecentBills,
  getBroadcastLists, createBroadcastList, getBroadcastListMembers,
  logBroadcast, getBroadcastHistory,
  createBroadcastCampaign, updateBroadcastCounts, getBroadcastMessages,
  // Consent tracking (DPDP Act)
  recordConsent, hasConsent,
  // Meta delivery status tracking
  updateDeliveryStatus, getDeliveryStats,
  // Webhook rate limiting
  checkWebhookRateLimit,
  // Master data: doctors / specialties
  getDoctors, getSpecialties, resolveDoctorId, resolveSpecialtyId,
  // Patient identity resolution
  resolvePatientId,
  // Audit log
  logAudit, getAuditLog,
  setup,
};
