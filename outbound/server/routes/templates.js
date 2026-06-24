const express = require('express');
const router = express.Router();
const templates = require('../services/templates');
const engagement = require('../services/engagement');
const db = require('../services/db');
const multer = require('multer');
const wa = require('../services/whatsapp');
const fs = require('fs');

const upload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB cap

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

// POST /api/templates/upload-image — uploads a banner image to Meta, returns
// a media_id the frontend holds onto and includes when calling /send.
router.post('/upload-image', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Image too large (max 5MB)' : err.message;
      return res.status(400).json({ success: false, message: msg });
    }
    if (err) return res.status(400).json({ success: false, message: 'Invalid upload' });
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image file received' });
    const mediaId = await wa.uploadMedia(req.file.path, req.file.mimetype);
    fs.unlink(req.file.path, () => {}); // cleanup temp file, fire-and-forget
    res.json({ success: true, mediaId });
  } catch (e) {
    res.status(502).json({ success: false, message: e.message || 'Upload to Meta failed' });
  }
});

// POST /api/templates/send — send any cached approved template to a recipient list.
// `params` = fixed placeholder values AFTER {{1}}; {{1}} is always the patient's
// name and is filled per-recipient automatically by broadcastTemplate's paramsFor.
router.post('/send', async (req, res, next) => {
  try {
    const { name, language, params, recipients, headerMediaId } = req.body;
    if (!name || !Array.isArray(recipients) || !recipients.length) {
      return res.status(400).json({ success: false, message: 'name and recipients[] required' });
    }
    const fixedParams = Array.isArray(params) ? params : [];
    const placeholderCount = typeof req.body.placeholderCount === 'number' ? req.body.placeholderCount : null;
    // Fetch the template's raw body_text so broadcastTemplate can log each
    // recipient's actual rendered message to Message History, instead of
    // the generic "Template send: <name>" placeholder.
    const bodyText = await templates.getTemplateBodyText(name, language || 'en').catch(() => null);
    const result = await engagement.broadcastTemplate({
      recipients,
      templateName: name,
      lang: language || 'en',
      paramsFor: (patientName) => placeholderCount === 0 ? [] : [patientName || 'there', ...fixedParams],
      campaignName: req.body.campaignName || name,
      logMessage: req.body.logMessage || `Template send: ${name}`,
      headerMediaId,
      bodyText,
      // This route sends ANY approved template a user picks — many (e.g.
      // welcome, appointment) have no button component at all. Unlike
      // sendHealthTip/sendOfferTemplate/sendCampInfo, which are each tied to
      // one specific template known to have a "Book" button, this path can't
      // assume one exists, so it must not auto-attach the button parameter.
      // Meta rejects template sends with a button parameter when the
      // template itself has no button component (error 132018).
      bookUrl: null,
    });
    await db.logAudit({ actor: req.actor || 'dashboard', action: 'send', entity: 'broadcast_template', entityId: name, after: { recipients: recipients.length } });
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
});

module.exports = router;
