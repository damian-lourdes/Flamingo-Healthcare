const config = require('../config');
const db     = require('./db');

const GRAPH = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;

// ── Core send ─────────────────────────────────────────────────────────────────
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
  } else {
    const msgId = d?.messages?.[0]?.id;
    console.log(`[wa] ✓ sent to ${payload.to} msgId:${msgId}`);
    healthState.consecutiveFails = 0;
    healthState.lastSuccess       = new Date().toISOString();
  }
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
async function sendTemplate(to, templateName, languageCode, bodyParams = [], bookUrlParam = null, { patientName, triggerType } = {}) {
  const components = [];

  // Body variables {{1}}, {{2}}... map in order to bodyParams
  if (bodyParams.length) {
    components.push({
      type: 'body',
      parameters: bodyParams.map(t => ({
      type: 'text',
      text: String(t ?? '').replace(/\s*\n+\s*/g, ' ').replace(/\s{4,}/g, '   ').trim() || '-',
    })),
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

module.exports = { sendText, sendButtons, sendTemplate, getHealth };
