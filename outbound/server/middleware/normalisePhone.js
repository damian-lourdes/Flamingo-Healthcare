/* server/middleware/normalisePhone.js
 * Normalises Indian mobile numbers to E.164 (+91XXXXXXXXXX).
 */
function normalisePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);                   // 0091... -> 91...
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1); // 0XXXXXXXXXX -> XXXXXXXXXX
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith('91')) return `+${d}`;
  if (d.length > 12) return `+${d}`;                        // longer international, pass through
  return null;                                              // reject malformed (e.g. +0...)
}

module.exports = normalisePhone;
