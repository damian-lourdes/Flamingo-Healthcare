/* server/routes/dashboard.js
 * Overview stats, message history, patient endpoints.
 */
const router     = require('express').Router();
const db         = require('../services/db');

// ── Overview state ────────────────────────────────────────────────────────────
router.get('/state', async (_req, res, next) => {
  try { res.json(await db.listState()); }
  catch (e) { next(e); }
});

// ── Message history ───────────────────────────────────────────────────────────
router.get('/history', async (req, res, next) => {
  try {
    const { phone, date, limit } = req.query;
    res.json(await db.getOutboundHistory({ phone, date, limit: parseInt(limit) || 200 }));
  } catch (e) { next(e); }
});

router.get('/history/dates', async (_req, res, next) => {
  try { res.json(await db.getOutboundByDate()); }
  catch (e) { next(e); }
});

router.get('/history/patient/:phone', async (req, res, next) => {
  try { res.json(await db.getPatientMessageHistory(decodeURIComponent(req.params.phone))); }
  catch (e) { next(e); }
});

// ── Patients ──────────────────────────────────────────────────────────────────
router.get('/patients', async (req, res, next) => {
  try { res.json(await db.getPatients(req.query)); }
  catch (e) { next(e); }
});

router.post('/patients', async (req, res, next) => {
  try {
    await db.upsertPatient(req.body);
    res.json({ success: true });
  } catch (e) { next(e); }
});

module.exports = router;
