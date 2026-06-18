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

// Header names we'll recognise for phone/name columns, case-insensitive.
// Falls back to column position (1st=phone, 2nd=name) if no header matches,
// since hospital-made spreadsheets won't always use these exact labels.
const PHONE_HEADERS = ['phone', 'mobile', 'contact', 'number', 'phone number', 'mobile number', 'contact number', 'whatsapp'];
const NAME_HEADERS  = ['name', 'patient name', 'full name', 'patient', 'customer name'];

function normalisePhoneLoose(raw) {
  if (raw === undefined || raw === null) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  return `+${digits}`;
}

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

    // Find which actual column header matches our recognised phone/name lists
    const headers = Object.keys(rows[0]);
    const findCol = (candidates) =>
      headers.find(h => candidates.includes(h.trim().toLowerCase()));
    let phoneCol = findCol(PHONE_HEADERS);
    let nameCol  = findCol(NAME_HEADERS);

    // Fall back to column position if no header matched
    if (!phoneCol) phoneCol = headers[0];
    if (!nameCol && headers.length > 1) nameCol = headers[1];

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
