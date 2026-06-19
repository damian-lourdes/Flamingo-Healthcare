/* server/services/templates.js
 * Syncs WhatsApp message templates from Meta's Graph API and caches them
 * locally so the dashboard can render a live, always-current picker
 * without any code change when a new template is approved.
 */
const config = require('../config');
const db = require('./db');

const GRAPH_BASE = `https://graph.facebook.com/${config.whatsapp.apiVersion}`;

// Pull every template Meta has approved/pending/rejected for this WABA.
async function fetchFromMeta() {
  if (!config.whatsapp.wabaId || !config.whatsapp.token) {
    throw new Error('META_WABA_ID or META_ACCESS_TOKEN not configured');
  }
  let url = `${GRAPH_BASE}/${config.whatsapp.wabaId}/message_templates?limit=100`;
  const all = [];
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${config.whatsapp.token}` } });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || `Meta API error (${r.status})`);
    all.push(...(data.data || []));
    url = data.paging?.next || null;
  }
  return all;
}

// Extract the BODY component's placeholder count + example values, since
// that's what the dashboard form needs to render input fields.
function parsePlaceholders(template) {
  const body = (template.components || []).find(c => c.type === 'BODY');
  // A template's HEADER component (if present) is always first per Meta's
  // spec. format === 'IMAGE' means a banner image is required at send time —
  // the dashboard needs this to ask for an upload before sending.
  const header = (template.components || []).find(c => c.type === 'HEADER');
  const hasImageHeader = header?.format === 'IMAGE';
  if (!body || !body.text) return { count: 0, examples: [], hasImageHeader };
  const matches = [...body.text.matchAll(/\{\{(\d+)\}\}/g)];
  const count = matches.length ? Math.max(...matches.map(m => parseInt(m[1], 10))) : 0;
  const examples = body.example?.body_text?.[0] || [];
  return { count, examples, bodyText: body.text, hasImageHeader };
}

// Sync Meta -> local cache table. Called by the /sync endpoint, on demand.
async function syncTemplates() {
  const templates = await fetchFromMeta();
  let upserted = 0;
  for (const t of templates) {
    const { count, examples, bodyText, hasImageHeader } = parsePlaceholders(t);
    await db.pool.query(
      `INSERT INTO whatsapp_templates (name, language, category, status, placeholder_count, body_text, examples, has_image_header, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (name, language) DO UPDATE SET
         category = EXCLUDED.category, status = EXCLUDED.status,
         placeholder_count = EXCLUDED.placeholder_count,
         body_text = EXCLUDED.body_text, examples = EXCLUDED.examples,
         has_image_header = EXCLUDED.has_image_header,
         synced_at = now()`,
      [t.name, t.language, t.category, t.status, count, bodyText || '', JSON.stringify(examples), !!hasImageHeader]
    );
    upserted++;
  }
  return { synced: upserted, total: templates.length };
}

async function listCached({ approvedOnly = false } = {}) {
  const where = approvedOnly ? `WHERE status = 'APPROVED'` : '';
  const rows = await db.pool.query(
    `SELECT name, language, category, status, placeholder_count, body_text, examples, has_image_header, synced_at
     FROM whatsapp_templates ${where} ORDER BY category, name`);
  return rows.rows.map(r => ({ ...r, examples: typeof r.examples === 'string' ? JSON.parse(r.examples) : r.examples }));
}

// Looks up a single template's raw body_text (with {{n}} placeholders still
// in place) by name + language. Used to render the real, personalized
// message text for Message History — without this, that view only ever
// showed a generic "Template send: <name>" placeholder instead of what the
// recipient actually received.
async function getTemplateBodyText(name, language = 'en') {
  const row = await db.pool.query(
    `SELECT body_text FROM whatsapp_templates WHERE name = $1 AND language = $2 LIMIT 1`,
    [name, language]
  );
  return row.rows[0]?.body_text || null;
}

module.exports = { syncTemplates, listCached, getTemplateBodyText };
