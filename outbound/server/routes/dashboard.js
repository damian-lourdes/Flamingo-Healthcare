/* server/routes/dashboard.js
 * Overview stats, message history, patient endpoints.
 */
const router     = require('express').Router();
const db         = require('../services/db');
const wa         = require('../services/whatsapp');

// ── Overview state ────────────────────────────────────────────────────────────
router.get('/state', async (_req, res, next) => {
  try {
    const state = await db.listState();
    const waHealth = wa.getHealth();
    res.json({
      ...state,
      // outbound is always "healthy" if this request is being served at all
      outbound_healthy: true,
      whatsapp_healthy: waHealth.healthy,
      whatsapp_error:   waHealth.lastError,
    });
  } catch (e) { next(e); }
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

router.get('/settings/:key', async (req, res, next) => {
  try { res.json({ key: req.params.key, value: await db.getSetting(req.params.key) }); }
  catch (e) { next(e); }
});

router.post('/settings/:key', async (req, res, next) => {
  try {
    await db.setSetting(req.params.key, req.body.value || '', req.actor || 'dashboard');
    await db.logAudit({ actor: req.actor || 'dashboard', action: 'update', entity: 'app_settings', entityId: req.params.key, after: { value: req.body.value } });
    res.json({ success: true });
  } catch (e) { next(e); }
});

module.exports = router;
