const config = require('../config');
const db     = require('./db');
const fs     = require('fs');

const GRAPH = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
const MEDIA_UPLOAD_URL = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/media`;

// ── Media upload ──────────────────────────────────────────────────────────────
// Uploads an image to Meta so it can be sent as a template's header image.
// Returns a media_id, which is reusable for multiple sends until it expires
// (Meta media IDs are valid for a limited time — re-upload if a send fails
// with a media-not-found error).
async function uploadMedia(filePath, mimeType) {
  const form = new FormData();
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: mimeType || 'image/jpeg' });
  form.append('file', blob, 'upload.jpg');
  form.append('type', mimeType || 'image/jpeg');
  form.append('messaging_product', 'whatsapp');

  const r = await fetch(MEDIA_UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.token}` },
    body: form,
  });
  const d = await r.json();
  if (!r.ok || !d.id) {
    console.error('[wa] MEDIA UPLOAD FAILED:', JSON.stringify(d?.error || d));
    throw new Error(d?.error?.message || 'Media upload failed');
  }
  return d.id; // media_id
}

// ── Core send ─────────────────────────────────────────────────────────────────
// Throws on any non-2xx response from Meta so callers' existing try/catch
// blocks (every caller in the codebase already has one — verified before
// making this change) correctly treat a rejected send as a failure, instead
// of silently logging the error and continuing as if it succeeded. Previously
// this function only logged failures to console and returned the error body,
// which meant every "sent" counter across the app (broadcasts, dialer
// thank-you messages, etc.) counted failed sends as successful.
async function post(payload) {
  const r = await fetch(GRAPH, {
    method:  'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  const d = await r.json();
  if (!r.ok) {
    console.error('[wa] SEND FAILED:', JSON.stringify(d?.error || d));
    console.error('[wa] HTTP status:', r.status);
    console.error('[wa] To:', payload.to, 'Type:', payload.type);
    healthState.lastError     = d?.error?.message || 'Send failed';
    healthState.lastErrorAt   = new Date().toISOString();
    healthState.consecutiveFails++;
    const err = new Error(d?.error?.message || `WhatsApp send failed (HTTP ${r.status})`);
    err.metaError = d?.error || d;
    err.httpStatus = r.status;
    throw err;
  }
  const msgId = d?.messages?.[0]?.id;
  console.log(`[wa] ✓ sent to ${payload.to} msgId:${msgId}`);
  healthState.consecutiveFails = 0;
  healthState.lastSuccess       = new Date().toISOString();
  return d;
}

// ── Send text with consent + delivery tracking ────────────────────────────────
async function sendText(to, body, { patientName, triggerType, outboundMsgId } = {}) {
  const d = await post({ to, type: 'text', text: { body, preview_url: false } });

  const waMessageId = d?.messages?.[0]?.id || null;

  // 1. Record consent — first WhatsApp contact = implicit DPDP opt-in
  if (waMessageId) {
    await db.recordConsent({
      phone: to, patientName: patientName || null, triggerType: triggerType || null,
    }).catch(() => {});

    // 2. Save wa_message_id to outbound_messages for delivery tracking
    if (outboundMsgId) {
      await db.pool?.query(
        'UPDATE outbound_messages SET wa_message_id=$1, delivery_status=$2 WHERE id=$3',
        [waMessageId, 'sent', outboundMsgId]
      ).catch(() => {});
    }

    // 3. Create delivery tracking record
    await db.updateDeliveryStatus({
      waMessageId, phone: to, status: 'sent',
    }).catch(() => {});
  }

  return d;
}

async function sendButtons(to, body, buttons) {
  return post({
    to, type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: { buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
    },
  });
}

// Send a Meta-approved template message.
// Required for marketing/business-initiated messages OUTSIDE the 24-hour window —
// free text (sendText) will not be delivered there.
async function sendTemplate(to, templateName, languageCode, bodyParams = [], bookUrlParam = null, { patientName, triggerType, headerMediaId } = {}) {
  const components = [];

  // Image header — must be the FIRST component if present, per Meta's spec
  if (headerMediaId) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { id: headerMediaId } }],
    });
  }

  // Body variables {{1}}, {{2}}... map in order to bodyParams
  if (bodyParams.length) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((t, i) => {
        const isLast = i === bodyParams.length - 1;
        const text = isLast
          ? String(t ?? '').trim() || '-'
          : String(t ?? '').replace(/\s*\n+\s*/g, ' ').replace(/\s{4,}/g, '   ').trim() || '-';
        return { type: 'text', text };
      }),
    });
  }

  // If the template has a dynamic URL button (our "Book" button), fill it
  if (bookUrlParam) {
    components.push({
      type: 'button', sub_type: 'url', index: '0',
      parameters: [{ type: 'text', text: String(bookUrlParam) }],
    });
  }

  const d = await post({
    to, type: 'template',
    template: { name: templateName, language: { code: languageCode || 'en' }, components },
  });

  // Mirror sendText: record DPDP consent + delivery tracking on success
  const waMessageId = d?.messages?.[0]?.id || null;
  if (waMessageId) {
    await db.recordConsent({ phone: to, patientName: patientName || null, triggerType: triggerType || null }).catch(() => {});
    await db.updateDeliveryStatus({ waMessageId, phone: to, status: 'sent' }).catch(() => {});
  }
  return d;
}

// ── Service health state (checked by dashboard API) ───────────────────────────
const healthState = {
  consecutiveFails: 0,
  lastError:        null,
  lastErrorAt:      null,
  lastSuccess:      null,
};

function getHealth() {
  return {
    healthy:         healthState.consecutiveFails < 3,
    consecutiveFails: healthState.consecutiveFails,
    lastError:        healthState.lastError,
    lastErrorAt:      healthState.lastErrorAt,
    lastSuccess:      healthState.lastSuccess,
  };
}

module.exports = { sendText, sendButtons, sendTemplate, uploadMedia, getHealth };
