/* scripts/migrate.js
 * Ensures all database tables exist with correct schema.
 * Safe to run repeatedly — uses CREATE TABLE IF NOT EXISTS.
 * Run: node scripts/migrate.js
 */
const db = require('../server/services/db');

async function migrate() {
  console.log('[migrate] Running schema migration…');
  await db.ensureSchema();
  console.log('[migrate] Done.');
  process.exit(0);
}

migrate().catch(e => {
  console.error('[migrate] Failed:', e.message);
  process.exit(1);
});
