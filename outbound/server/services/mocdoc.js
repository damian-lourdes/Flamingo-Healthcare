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
 * GET /api/get/ptlist/{EntityKey}
 * Returns registered patients for a given date
 */
async function getPatientsByDate(date) {
  return get(`/api/get/ptlist/${E()}/${date || today()}`);
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
 * GET /api/get/opvisits/{EntityKey}/{Location}/{Date}
 * Returns OP visits for a given date
 */
const getOPVisits = (date) =>
  get(`/api/get/opvisits/${E()}/${L()}/${date || today()}`);

/**
 * GET /api/get/checkedin/{EntityKey}/{Location}
 * Returns checked-in patients
 */
const getCheckedIn = () =>
  get(`/api/get/checkedin/${E()}/${L()}`);

// ── Inpatient (IP) ────────────────────────────────────────────────────────────

/**
 * GET /api/get/ipadmissions/{EntityKey}/{Location}/{Date}
 */
const getIPAdmissions = (date) =>
  get(`/api/get/ipadmissions/${E()}/${L()}/${date || today()}`);

/**
 * GET /api/get/ipdischarges/{EntityKey}/{Location}/{Date}
 */
const getIPDischarges = (date) =>
  get(`/api/get/ipdischarges/${E()}/${L()}/${date || today()}`);

/**
 * GET /api/get/iproomtransfers/{EntityKey}/{Location}/{Date}
 */
const getIPRoomTransfers = (date) =>
  get(`/api/get/iproomtransfers/${E()}/${L()}/${date || today()}`);

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
 * GET /api/lims/laborders/{EntityKey}/{Location}/{Date}
 */
const getLabOrders = (date) =>
  get(`/api/lims/laborders/${E()}/${L()}/${date || today()}`);

/**
 * GET /api/lims/labresults/{EntityKey}/{Location}/{Date}
 */
const getLabResults = (date) =>
  get(`/api/lims/labresults/${E()}/${L()}/${date || today()}`);

// ── MIS (for analytics / billing data) ───────────────────────────────────────

/** GET /api/mis/bills/{EntityKey}/{Location}/{Date} */
const getBills = (date) =>
  get(`/api/mis/bills/${E()}/${L()}/${date || today()}`);

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
