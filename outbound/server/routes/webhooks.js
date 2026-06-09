/* server/routes/webhooks.js
 * MocDoc webhook receiver (ready for when they release webhooks).
 * WhatsApp webhook verification endpoint.
 */
const router = require('express').Router();
const sync   = require('../services/mocdoc-sync');
const config = require('../config');

// ── WhatsApp webhook verification ─────────────────────────────────────────────
router.get('/whatsapp', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    console.log('[webhook] WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── MocDoc webhook receiver ───────────────────────────────────────────────────
// Register: POST https://your-server.com/webhooks/mocdoc with MocDoc
// Then comment out sync.start() in server/index.js — polling becomes redundant.
router.post('/mocdoc', async (req, res) => {
  res.sendStatus(200); // Acknowledge fast
  const { event, data } = req.body;
  if (!event || !data) return;
  try { await sync.handleWebhook(event, data); }
  catch (e) { console.error('[mocdoc-webhook]', e.message); }
});

module.exports = router;
