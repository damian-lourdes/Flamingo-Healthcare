/* server/routes/engagement.js
 * Manual engagement triggers fired from the reception dashboard.
 */
const router     = require('express').Router();
const engagement = require('../services/engagement');

router.post('/lab-report-ready', async (req, res, next) => {
  try {
    const { phone, name, testName, doctor, labVisitId } = req.body;
    await engagement.onLabReportReady({ phone, name, testName, doctor, labVisitId });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.post('/discharge', async (req, res, next) => {
  try {
    const { phone, patientName, doctor, specialty, admissionId } = req.body;
    await engagement.onDischarge({ phone, patientName, doctor, specialty, admissionId });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.post('/post-consultation', async (req, res, next) => {
  try {
    const { phone, name, doctor, specialty, followUpDate } = req.body;
    await engagement.onConsultationComplete({ phone, name, doctor, specialty, followUpDate });
    res.json({ success: true });
  } catch (e) { next(e); }
});

module.exports = router;
