/** Small helpers shared by the server modules. */
const crypto = require('crypto');
const { HttpError } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

/** Today's date (YYYY-MM-DD) in the hotel's time zone. */
function today(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function str(v, { max, min = 0, field }) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) throw new HttpError(400, `${field} is required.`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (maximum ${max} characters).`);
  return s;
}
function int(v, { min, max, field }) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number between ${min} and ${max}.`);
  return n;
}

/** Writes an entry to the activity log (who did what). */
function log(db, user, action, entity, entityId, detail) {
  db.prepare('INSERT INTO activity (at,user_id,action,entity,entity_id,detail) VALUES (?,?,?,?,?,?)')
    .run(nowIso(), user ? user.id : null, action, entity, entityId, detail ? JSON.stringify(detail) : null);
}

module.exports = { EMAIL_RE, uid, nowIso, today, str, int, log };
