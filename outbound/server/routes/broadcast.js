/* server/routes/broadcast.js
 * Health tip, offer, personalised message, and broadcast list management.
 *
 * Everything here is admin-only EXCEPT /personalised — that's a single-
 * patient message (similar in kind to the per-patient engagement triggers
 * front desk already has), while everything else here is a bulk send or
 * the campaign infrastructure behind one, which stays with admin.
 */
const router     = require('express').Router();
const db         = require('../services/db');
const engagement = require('../services/engagement');
const requireRole = require('../middleware/requireRole');
const multer     = require('multer');
const XLSX       = require('xlsx');
const fs         = require('fs');

const adminOnly = requireRole('admin');
const upload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB cap

// Header names we'll recognise for phone/name columns. Matched with
// "contains" rather than exact equality, so real-world headers like
// "Contact No", "Mobile Number", "Patient Phone" all match even though
// they're not exact matches to a short candidate list.
const PHONE_HEADERS = ['phone', 'mobile', 'contact', 'number', 'whatsapp'];
const NAME_HEADERS  = ['name', 'patient', 'customer'];

function findCol(headers, candidates) {
  const lower = headers.map(h => h.trim().toLowerCase());
  // First pass: prefer a header that contains a candidate word (e.g.
  // "Contact No" contains "contact").
  for (let i = 0; i < lower.length; i++) {
    if (candidates.some(c => lower[i].includes(c))) return headers[i];
  }
  return null;
}

// Normalises a phone number for sending. Indian 10-digit numbers (and
// 11-digit with a leading trunk 0) get +91 added. Anything that already
// looks like it has its own country code (11+ digits, or already starts
// with +) is kept as-is rather than being forced into +91 — this matters
// for any contact list that isn't purely Indian patients (e.g. staff,
// international referrers).
function normalisePhoneLoose(raw) {
  if (raw === undefined || raw === null) return '';
  const str = String(raw).trim();
  if (!str) return '';
  const digits = str.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.length === 10) return `+91${digits}`;                  // bare Indian mobile
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`; // Indian with trunk 0
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`; // Indian with 91, no +
  // Anything else (11-15 digits) is assumed to already carry its own
  // country code — e.g. +65 9169 4890, +1 (225) 326-0416 — so we just
  // add the + back rather than guessing it's Indian.
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return '';
}

// ── Broadcast lists ───────────────────────────────────────────────────────────
router.get('/lists', adminOnly, async (_req, res, next) => {
  try { res.json(await db.getBroadcastLists()); }
  catch (e) { next(e); }
});

router.post('/lists', adminOnly, async (req, res, next) => {
  try {
    const { name, description, phones } = req.body;
    const id = await db.createBroadcastList({ name, description, phones: phones || [] });
    res.json({ success: true, id });
  } catch (e) { next(e); }
});

router.get('/lists/:id/members', adminOnly, async (req, res, next) => {
  try { res.json(await db.getBroadcastListMembers(req.params.id)); }
  catch (e) { next(e); }
});

// POST /api/broadcast/lists/parse-file — accepts an uploaded Excel/CSV file,
// returns parsed {phone, name} rows for the frontend to show in a review
// step before saving as a list (nothing is saved here — just parsed).
router.post('/lists/parse-file', adminOnly, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 5MB)' : err.message;
      return res.status(400).json({ success: false, message: msg });
    }
    if (err) return res.status(400).json({ success: false, message: 'Invalid upload' });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file received' });

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    fs.unlink(req.file.path, () => {}); // cleanup temp file, fire-and-forget

    if (!rows.length) {
      return res.json({ success: true, rows: [], warning: 'No rows found in the file' });
    }

    const headers = Object.keys(rows[0]);
    let phoneCol = findCol(headers, PHONE_HEADERS);
    let nameCol  = findCol(headers, NAME_HEADERS);

    // Fall back to column position only if NEITHER header matched anything
    // recognisable — and even then, guess based on which column actually
    // contains phone-number-shaped values, not just "column 1 = phone".
    if (!phoneCol) {
      const sample = rows[0];
      phoneCol = headers.find(h => normalisePhoneLoose(sample[h])) || headers[0];
    }
    if (!nameCol) {
      nameCol = headers.find(h => h !== phoneCol) || null;
    }

    const parsed = rows
      .map(r => ({
        phone: normalisePhoneLoose(r[phoneCol]),
        name: nameCol ? String(r[nameCol] || '').trim() : '',
      }))
      .filter(r => r.phone); // drop rows with no usable phone number

    const skipped = rows.length - parsed.length;
    res.json({
      success: true,
      rows: parsed,
      matchedColumns: { phone: phoneCol, name: nameCol || null },
      warning: skipped > 0 ? `${skipped} row(s) skipped — no valid phone number found` : undefined,
    });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message || 'Could not parse file — is it a valid Excel or CSV file?' });
  }
});

// ── Campaign history ──────────────────────────────────────────────────────────
router.get('/history', adminOnly, async (_req, res, next) => {
  try { res.json(await db.getBroadcastHistory()); }
  catch (e) { next(e); }
});

// Individual messages sent as part of a given campaign (drill-down).
router.get('/history/:id/messages', adminOnly, async (req, res, next) => {
  try { res.json(await db.getBroadcastMessages(req.params.id)); }
  catch (e) { next(e); }
});

// ── Send broadcasts ───────────────────────────────────────────────────────────
router.post('/health-tip', adminOnly, async (req, res, next) => {
  try {
    const { recipients } = req.body;
    const campaignName = req.body.campaignName || req.body.campaign_name || 'Health tip';
    const tip = req.body.tip || req.body.message;   // accept old field name too
    const result = await engagement.sendHealthTip({ recipients, tip, campaignName });
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
});

router.post('/offer', adminOnly, async (req, res, next) => {
  try {
    const { recipients } = req.body;
    const offerTitle   = req.body.offerTitle   || req.body.offer_title;
    const offerDetails = req.body.offerDetails || req.body.offer_details;
    const validTill    = req.body.validTill    || req.body.valid_till;
    const result = await engagement.sendOfferTemplate({ recipients, offerTitle, offerDetails, validTill });
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
});

router.post('/camp', adminOnly, async (req, res, next) => {
  try {
    const { recipients, campType, date, venue, details } = req.body;
    const result = await engagement.sendCampInfo({ recipients, campType, date, venue, details });
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
});

// Open to both roles — a single message to one patient, not a bulk send.
router.post('/personalised', async (req, res, next) => {
  try {
    const { phone, name, message } = req.body;
    await engagement.sendPersonalised({ phone, name, message });
    res.json({ success: true });
  } catch (e) { next(e); }
});

module.exports = router;
