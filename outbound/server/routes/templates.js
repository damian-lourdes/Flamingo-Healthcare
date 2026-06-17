const express = require('express');
const router = express.Router();
const templates = require('../services/templates');
const engagement = require('../services/engagement');
const db = require('../services/db');

// POST /api/templates/sync — pull latest from Meta into the local cache
router.post('/sync', async (req, res, next) => {
  try {
    const result = await templates.syncTemplates();
    await db.logAudit({ actor: req.actor || 'dashboard', action: 'sync', entity: 'whatsapp_templates', entityId: null, after: result });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(502).json({ success: false, message: e.message || 'Sync with Meta failed' });
  }
});

// GET /api/templates — list cached templates (approved-only by default)
router.get('/', async (req, res, next) => {
  try {
    const approvedOnly = req.query.all !== 'true';
    res.json(await templates.listCached({ approvedOnly }));
  } catch (e) { next(e); }
});

// POST /api/templates/send — send any cached approved template to a recipient list
router.post('/send', async (req, res, next) => {
  try {
    const { name, language, params, recipients } = req.body;
    if (!name || !Array.isArray(recipients) || !recipients.length) {
      return res.status(400).json({ success: false, message: 'name and recipients[] required' });
    }
    const result = await engagement.broadcastTemplate({ templateName: name, language: language || 'en', params: params || [], recipients });
    await db.logAudit({ actor: req.actor || 'dashboard', action: 'send', entity: 'broadcast_template', entityId: name, after: { recipients: recipients.length } });
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
});

module.exports = router;
