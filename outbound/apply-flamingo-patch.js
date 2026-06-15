const fs = require('fs');
const path = require('path');

function patch(file, edits) {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) { console.log(`SKIP  ${file} (not found)`); return; }
  let src = fs.readFileSync(full, 'utf8');
  let changed = false;
  for (const e of edits) {
    if (src.includes(e.done))   { console.log(`ok    ${file}: ${e.label} (already applied)`); continue; }
    if (!src.includes(e.anchor)){ console.log(`WARN  ${file}: ${e.label} — anchor NOT found, skipped`); continue; }
    src = src.replace(e.anchor, e.replace);
    changed = true;
    console.log(`DONE  ${file}: ${e.label}`);
  }
  if (changed) fs.writeFileSync(full, src);
}

// ── db.js ─────────────────────────────────────────────────────────────────────
patch('outbound/server/services/db.js', [
  {
    label: 'app_settings table',
    done:  'CREATE TABLE IF NOT EXISTS app_settings',
    anchor:'CREATE TABLE IF NOT EXISTS audit_log (',
    replace:
`CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_by TEXT DEFAULT 'system',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_log (`,
  },
  {
    label: 'getSetting/setSetting functions',
    done:  'async function getSetting(',
    anchor:'module.exports = {',
    replace:
`async function getSetting(key, fallback = null) {
  const row = await q1('SELECT value FROM app_settings WHERE key=$1', [key]);
  return row ? row.value : fallback;
}
async function setSetting(key, value, actor = 'dashboard') {
  await pool.query(
    \`INSERT INTO app_settings(key, value, updated_by) VALUES($1,$2,$3)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=NOW()\`,
    [key, value, actor]
  );
}

module.exports = {`,
  },
  {
    label: 'export getSetting/setSetting',
    done:  'getSetting, setSetting,',
    anchor:'  logAudit, getAuditLog,',
    replace:'  logAudit, getAuditLog,\n  getSetting, setSetting,',
  },
]);

// ── dashboard.js ──────────────────────────────────────────────────────────────
patch('outbound/server/routes/dashboard.js', [
  {
    label: 'settings endpoints',
    done:  "router.get('/settings/:key'",
    anchor:'module.exports = router;',
    replace:
`router.get('/settings/:key', async (req, res, next) => {
  try { res.json({ key: req.params.key, value: await db.getSetting(req.params.key) }); }
  catch (e) { next(e); }
});

router.post('/settings/:key', async (req, res, next) => {
  try {
    await db.setSetting(req.params.key, req.body.value || '', req.actor || 'dashboard');
    await db.logAudit({ actor: req.actor || 'dashboard', action: 'update', entity: 'app_settings', entityId: req.params.key, after: { value: req.body.value } });
    res.json({ success: true });
  } catch (e) { next(e); }
});

module.exports = router;`,
  },
]);

// ── scheduler.js ──────────────────────────────────────────────────────────────
patch('outbound/server/services/scheduler.js', [
  {
    label: 'monthly tip reads from DB',
    done:  "db.getSetting('monthly_health_tip'",
    anchor:'const tip = config.monthlyHealthTip;',
    replace:"const tip = await db.getSetting('monthly_health_tip', config.monthlyHealthTip);",
  },
]);

console.log('\nDone. Review changes with:  git diff');
