/* server/routes/broadcast.js
 * Health tip, offer, personalised message, and broadcast list management.
 */
const router     = require('express').Router();
const db         = require('../services/db');
const engagement = require('../services/engagement');

// ── Broadcast lists ───────────────────────────────────────────────────────────
router.get('/lists', async (_req, res, next) => {
  try { res.json(await db.getBroadcastLists()); }
  catch (e) { next(e); }
});

router.post('/lists', async (req, res, next) => {
  try {
    const { name, description, phones } = req.body;
    const id = await db.createBroadcastList({ name, description, phones: phones || [] });
    res.json({ success: true, id });
  } catch (e) { next(e); }
});

router.get('/lists/:id/members', async (req, res, next) => {
  try { res.json(await db.getBroadcastListMembers(req.params.id)); }
  catch (e) { next(e); }
});

// ── Campaign history ──────────────────────────────────────────────────────────
router.get('/history', async (_req, res, next) => {
  try { res.json(await db.getBroadcastHistory()); }
  catch (e) { next(e); }
});

// Individual messages sent as part of a given campaign (drill-down).
router.get('/history/:id/messages', async (req, res, next) => {
  try { res.json(await db.getBroadcastMessages(req.params.id)); }
  catch (e) { next(e); }
});

// ── Send broadcasts ───────────────────────────────────────────────────────────
router.post('/health-tip', async (req, res, next) => {
  try {
    const { recipients, campaignName } = req.body;
    const tip = req.body.tip || req.body.message;   // accept old field name too
    const result = await engagement.sendHealthTip({ recipients, tip, campaignName });
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
});

router.post('/offer', async (req, res, next) => {
  try {
    const { recipients, offerTitle, offerDetails, validTill } = req.body;
    const result = await engagement.sendOfferTemplate({ recipients, offerTitle, offerDetails, validTill });
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
});

router.post('/camp', async (req, res, next) => {
  try {
    const { recipients, campType, date, venue, details } = req.body;
    const result = await engagement.sendCampInfo({ recipients, campType, date, venue, details });
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
});

router.post('/personalised', async (req, res, next) => {
  try {
    const { phone, name, message } = req.body;
    await engagement.sendPersonalised({ phone, name, message });
    res.json({ success: true });
  } catch (e) { next(e); }
});

module.exports = router;
