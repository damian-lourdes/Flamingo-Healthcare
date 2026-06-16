/* MocDoc API Client — built from https://mocdoc.com/api/docs
 *
 * Authentication: HMAC-SHA256
 * String-To-Sign: HTTP_METHOD + '\n' + path_and_query + '\n' + signed_headers_values
 * Authorization header: MD {accesskey}:{base64(HMACSHA256(stringToSign, secret))}
 *
 * Rate limit: minimum 3 seconds between requests
 * Date retrieval: one day per call — loop for date ranges
 */
const crypto = require('crypto');
const config = require('../config');

const BASE = config.mocdoc.baseUrl.replace('/api','');
const E    = () => config.mocdoc.entityKey;
const L    = () => config.mocdoc.location;

// ── HMAC-SHA256 signature ─────────────────────────────────────────────────────
function buildHeaders(method, path, contentType = 'application/x-www-form-urlencoded') {
  const date   = new Date().toUTCString();
  // String-To-Sign per MocDoc docs:
  // "POST" + '\n\n' + "application/x-www-form-urlencoded" + '\n' + date + '\n\n' + path
  const sts    = `${method}\n\n${contentType}\n${date}\n\n${path}`;
  const secret = Buffer.from(config.mocdoc.secret || '', 'base64');
  const sig    = crypto.createHmac('sha256', secret).update(sts).digest('base64');
  return {
    'Date':          date,
    'Content-Type':  contentType,
    'Authorization': `MD ${config.mocdoc.accessKey}:${sig}`,
  };
}

// Rate limit: 3s between requests
let lastCall = 0;
async function throttle() {
  const wait = 3000 - (Date.now() - lastCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
}

async function get(path) {
  await throttle();
  const r = await fetch(`${BASE}${path}`, { headers: buildHeaders('GET', path) });
  if (!r.ok) throw new Error(`MocDoc GET ${path} → ${r.status} ${r.statusText}`);
  return r.json();
}

async function post(path, body = {}) {
  await throttle();
  const params = new URLSearchParams(body).toString();
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: buildHeaders('POST', path),
    body: params,
  });
  if (!r.ok) throw new Error(`MocDoc POST ${path} → ${r.status} ${r.statusText}`);
  return r.json();
}

// ── Today / date helpers ──────────────────────────────────────────────────────
function today() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
}

function toMocDocDate(jsDate) {
  const d = jsDate instanceof Date ? jsDate : new Date(jsDate);
  return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
}

// MocDoc's pull APIs expect date params as YYYYMMDD (per /api/docs).
function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

// ── Master Data ───────────────────────────────────────────────────────────────

/** GET /api/locationlist/{EntityKey} */
const getLocations = () => get(`/api/locationlist/${E()}`);

/** POST /api/get/userlist/{EntityKey} */
const getUsers = () => post(`/api/get/userlist/${E()}`, { entitylocation: L() });

/** POST /api/get/dr/{EntityKey} — get all doctors */
const getDoctors = () => post(`/api/get/dr/${E()}`, { entitylocation: L() });

/** POST /api/masters/referrals/{EntityKey} */
const getReferrals = () => post(`/api/masters/referrals/${E()}`);

/** POST /api/masters/testprofiles/{EntityKey} — lab tests & profiles */
const getTestProfiles = () => post(`/api/masters/testprofiles/${E()}`);

// ── Patient Management ────────────────────────────────────────────────────────

/**
 * POST /api/register/patient/{EntityKey}
 * Required: entitykey, entitylocation + patient fields
 * Returns: { status, data: { phid } }
 */
async function registerPatient({ name, phone, age, gender = 'U', dob = null }) {
  const body = {
    entitykey:      E(),
    entitylocation: L(),
    patient_name:   name,
    mobile:         phone.replace(/\D/g, '').slice(-10),
    age:            age || 30,
    gender,
  };
  if (dob) body.dob = dob; // format: DDMMYYYY
  return post(`/api/register/patient/${E()}`, body);
}

/**
 * POST /api/update/patient/{EntityKey}
 * Required: phid
 */
async function updatePatient(phid, fields) {
  return post(`/api/update/patient/${E()}`, { phid, ...fields });
}

/**
 * POST /api/get/ptlist/{EntityKey}
 * Returns registered patients for a given date.
 * Per docs: POST, application/x-www-form-urlencoded, registrationdate=YYYYMMDD
 * (required), entitylocation (optional). Date is a body param, not a URL
 * path segment — this was the cause of persistent 404s.
 */
async function getPatientsByDate(date) {
  return post(`/api/get/ptlist/${E()}`, {
    registrationdate: date || todayYmd(),
    entitylocation:   L(),
  });
}

/**
 * Find patient by mobile — search registered patients list
 * MocDoc doesn't have a direct search by phone endpoint,
 * so we POST to ptlist with a mobile filter
 */
async function findPatientByPhone(phone) {
  const mobile = phone.replace(/\D/g, '').slice(-10);
  try {
    const d = await post(`/api/get/ptlist/${E()}`, { mobile });
    return d?.patients?.[0] || null;
  } catch { return null; }
}

/** Get or create patient — used before booking */
async function getOrCreatePatient({ phone, name, age }) {
  const existing = await findPatientByPhone(phone);
  if (existing?.phid) return existing;
  const result = await registerPatient({ name, phone, age });
  return result?.data ? { phid: result.data.phid, patient_name: name } : null;
}

// ── Appointment & Visit ───────────────────────────────────────────────────────

/**
 * POST /api/bookappointment/{EntityKey}  (inferred from docs pattern)
 * Books an appointment
 */
async function bookAppointment({ patientId, doctorKey, date, slot, notes = '' }) {
  return post(`/api/bookappointment/${E()}`, {
    entitykey:      E(),
    entitylocation: L(),
    phid:           patientId,
    drkey:          doctorKey,
    apt_date:       date,       // DD-MM-YYYY
    apt_time:       slot,       // HH:MM
    notes,
  });
}

/**
 * POST /api/updateappointmentstatus/{EntityKey}
 * status: 'A'=Arrived, 'CO'=Completed, 'C'=Cancelled, 'NS'=No-show
 */
async function updateAppointmentStatus(aptId, status) {
  return post(`/api/updateappointmentstatus/${E()}`, {
    entitylocation: L(),
    apt_id:         aptId,
    status,
  });
}

/**
 * GET /api/calendar/{EntityKey}/{Location}/{DoctorKey}/{Date}
 * Returns available slots for a doctor on a given date
 */
const getDoctorCalendar = (drKey, date) =>
  get(`/api/calendar/${E()}/${L()}/${drKey}/${date || today()}`);

/**
 * POST /api/get/visitdata/{EntityKey}
 * Returns OP visits for a given date.
 * Per docs: POST, application/x-www-form-urlencoded, date=YYYYMMDD
 * (required), entitylocation (optional). Date is a body param, not a URL
 * path segment, and the path itself is /get/visitdata, not /get/opvisits.
 */
const getOPVisits = (date) =>
  post(`/api/get/visitdata/${E()}`, {
    date:           date || todayYmd(),
    entitylocation: L(),
  });

/**
 * GET /api/get/checkedin/{EntityKey}/{Location}
 * Returns checked-in patients
 */
const getCheckedIn = () =>
  get(`/api/get/checkedin/${E()}/${L()}`);

// ── Inpatient (IP) ────────────────────────────────────────────────────────────

/**
 * POST /api/get/ipadmission/{EntityKey}
 * Per docs: POST, application/x-www-form-urlencoded.
 * Required: entitykey, entitylocation, date (YYYYMMDD). Optional: drdept.
 * (Path is singular "ipadmission", not "ipadmissions" — date is a body
 * param, not a URL path segment.)
 */
const getIPAdmissions = (date) =>
  post(`/api/get/ipadmission/${E()}`, {
    entitykey:      E(),
    entitylocation: L(),
    date:           date || todayYmd(),
  });

/**
 * POST /api/get/ipdischarge/{EntityKey}
 * Per docs: POST, application/x-www-form-urlencoded.
 * Required: entitykey, entitylocation, date (YYYYMMDD).
 * (Path is singular "ipdischarge", not "ipdischarges" — date is a body
 * param, not a URL path segment.)
 */
const getIPDischarges = (date) =>
  post(`/api/get/ipdischarge/${E()}`, {
    entitykey:      E(),
    entitylocation: L(),
    date:           date || todayYmd(),
  });

/**
 * POST /api/get/transferroom/{EntityKey}
 * Body: entitylocation, date (YYYYMMDD). Returns { transferroomlist: [...] }.
 * Corrected from the earlier GET /api/get/iproomtransfers stub, which is not
 * a real MocDoc endpoint (the documented one is POST /api/get/transferroom).
 */
const getIPRoomTransfers = (date) =>
  post(`/api/get/transferroom/${E()}`, { entitylocation: L(), date: date || todayYmd() });

// ── Laboratory ────────────────────────────────────────────────────────────────

/**
 * POST /api/lims/laborder/create/{EntityKey}
 * Creates a lab order
 */
async function createLabOrder({ patientId, tests, doctorKey }) {
  return post(`/api/lims/laborder/create/${E()}`, {
    entitykey:      E(),
    entitylocation: L(),
    phid:           patientId,
    drkey:          doctorKey,
    tests:          JSON.stringify(tests), // array of test keys
  });
}

/**
 * POST /api/orderlist/{EntityKey}
 * Returns lab orders for a given date + time window.
 * Per docs: POST, application/x-www-form-urlencoded.
 * Required: entitykey, date (YYYYMMDD), starttime, endtime (HH:MM).
 * No entitylocation param on this endpoint. starttime/endtime default to a
 * full-day window (00:00–23:59) since our daily sync has no narrower window.
 */
const getLabOrders = (date, starttime = '00:00', endtime = '23:59') =>
  post(`/api/orderlist/${E()}`, {
    entitykey: E(),
    date:      date || todayYmd(),
    starttime,
    endtime,
  });

/**
 * POST /api/orderresult/{EntityKey}
 * Returns test results for a given date + time window.
 * Per docs: POST, application/x-www-form-urlencoded.
 * Required: date (YYYYMMDD), starttime, endtime (HH:MM). orderkey optional
 * (narrows to one specific order). No entitykey/entitylocation body params
 * on this endpoint — EntityKey only appears in the URL path.
 * starttime/endtime default to a full-day window since our daily sync has
 * no narrower window.
 */
const getLabResults = (date, starttime = '00:00', endtime = '23:59', orderkey) =>
  post(`/api/orderresult/${E()}`, {
    date: date || todayYmd(),
    starttime,
    endtime,
    ...(orderkey ? { orderkey } : {}),
  });

// ── MIS (for analytics / billing data) ───────────────────────────────────────

/** POST /api/get/billlist/{EntityKey}
 * Returns bill list for a given date.
 * Per docs: POST, application/x-www-form-urlencoded.
 * Required: entitykey, date (YYYYMMDD). No entitylocation param on this
 * endpoint, and date is a body param, not a URL path segment.
 */
const getBills = (date) =>
  post(`/api/get/billlist/${E()}`, {
    entitykey: E(),
    date:      date || todayYmd(),
  });

module.exports = {
  // Helpers
  today, toMocDocDate,

  // Master data
  getLocations, getUsers, getDoctors, getReferrals, getTestProfiles,

  // Patient management
  registerPatient, updatePatient, findPatientByPhone,
  getPatientsByDate, getOrCreatePatient,

  // Appointments
  bookAppointment, updateAppointmentStatus,
  getDoctorCalendar, getOPVisits, getCheckedIn,

  // IP
  getIPAdmissions, getIPDischarges, getIPRoomTransfers,

  // Lab
  createLabOrder, getLabOrders, getLabResults,

  // MIS
  getBills,
};
