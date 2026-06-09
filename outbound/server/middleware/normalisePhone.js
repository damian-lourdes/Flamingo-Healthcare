/* server/middleware/normalisePhone.js
 * Normalises Indian mobile numbers to E.164 (+91XXXXXXXXXX).
 * Can be used as a standalone helper anywhere in the app.
 */
function normalisePhone(raw) {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, '');
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith('91')) return `+${d}`;
  if (d.length > 10) return `+${d}`;
  return null;
}

module.exports = normalisePhone;
