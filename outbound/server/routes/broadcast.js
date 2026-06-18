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

const adminOnly = requireRole('admin');

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
