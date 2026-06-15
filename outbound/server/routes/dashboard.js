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

router.get('/patients/birthdays', async (_req, res, next) => {
  try { res.json(await db.getBirthdaysToday()); }
  catch (e) { next(e); }
});

router.post('/patients', async (req, res, next) => {
  try {
    await db.upsertPatient(req.body);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// ── Master data: doctors & specialties ────────────────────────────────────────
router.get('/doctors', async (_req, res, next) => {
  try { res.json(await db.getDoctors()); }
  catch (e) { next(e); }
});

router.post('/doctors', async (req, res, next) => {
  try {
    const { name, specialty } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = await db.resolveDoctorId(name, specialty || null, req.actor || 'dashboard');
    await db.logAudit({
      actor: req.actor || 'dashboard', action: 'upsert', entity: 'doctors',
      entityId: id, after: { name, specialty },
    });
    res.json({ success: true, id });
  } catch (e) { next(e); }
});

router.get('/specialties', async (_req, res, next) => {
  try { res.json(await db.getSpecialties()); }
  catch (e) { next(e); }
});

router.post('/specialties', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = await db.resolveSpecialtyId(name, req.actor || 'dashboard');
    await db.logAudit({
      actor: req.actor || 'dashboard', action: 'upsert', entity: 'specialties',
      entityId: id, after: { name },
    });
    res.json({ success: true, id });
  } catch (e) { next(e); }
});

// ── Audit log ─────────────────────────────────────────────────────────────────
router.get('/audit-log', async (req, res, next) => {
  try {
    const { limit, entity } = req.query;
    res.json(await db.getAuditLog(parseInt(limit) || 200, entity || null));
  } catch (e) { next(e); }
});

module.exports = router;
