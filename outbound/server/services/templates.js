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
  if (!body || !body.text) return { count: 0, examples: [] };
  const matches = [...body.text.matchAll(/\{\{(\d+)\}\}/g)];
  const count = matches.length ? Math.max(...matches.map(m => parseInt(m[1], 10))) : 0;
  const examples = body.example?.body_text?.[0] || [];
  return { count, examples, bodyText: body.text };
}

// Sync Meta -> local cache table. Called by the /sync endpoint, on demand.
async function syncTemplates() {
  const templates = await fetchFromMeta();
  let upserted = 0;
  for (const t of templates) {
    const { count, examples, bodyText } = parsePlaceholders(t);
    await db.pool.query(
      `INSERT INTO whatsapp_templates (name, language, category, status, placeholder_count, body_text, examples, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (name, language) DO UPDATE SET
         category = EXCLUDED.category, status = EXCLUDED.status,
         placeholder_count = EXCLUDED.placeholder_count,
         body_text = EXCLUDED.body_text, examples = EXCLUDED.examples,
         synced_at = now()`,
      [t.name, t.language, t.category, t.status, count, bodyText || '', JSON.stringify(examples)]
    );
    upserted++;
  }
  return { synced: upserted, total: templates.length };
}

async function listCached({ approvedOnly = false } = {}) {
  const where = approvedOnly ? `WHERE status = 'APPROVED'` : '';
  const rows = await db.pool.query(
    `SELECT name, language, category, status, placeholder_count, body_text, examples, synced_at
     FROM whatsapp_templates ${where} ORDER BY category, name`);
  return rows.rows.map(r => ({ ...r, examples: typeof r.examples === 'string' ? JSON.parse(r.examples) : r.examples }));
}

module.exports = { syncTemplates, listCached };
