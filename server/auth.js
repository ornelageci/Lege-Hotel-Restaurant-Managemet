const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('./config');
const { HttpError } = require('./errors');

const COOKIE = 'lege_token';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const ROLES = ['manager', 'receptionist'];
// Dummy hash: used when the user does not exist so the response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('no-valid-password-here', 10);

/** Password stamp: when the password changes, all old tokens stop being valid. */
const pwStamp = (hash) => crypto.createHash('sha256').update(hash).digest('hex').slice(0, 12);

function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 10 && pw.length <= 200;
}
function hashPassword(pw) { return bcrypt.hashSync(pw, 11); }

function createUser(db, { email, name, password, role }) {
  if (!validPassword(password)) throw new HttpError(400, 'The password must be at least 10 characters long.');
  if (!ROLES.includes(role)) throw new HttpError(400, 'Role must be manager or receptionist.');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)')
    .run(id, String(email).trim().toLowerCase(), String(name).trim(), hashPassword(password), role, new Date().toISOString());
  return id;
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, pv: pwStamp(user.password_hash) }, config.jwtSecret, { expiresIn: '12h' });
}
function setCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: MAX_AGE_MS, path: '/',
  });
}

/**
 * Loads the user from the "Authorization: Bearer <token>" header (separate frontends)
 * or from the cookie (built-in interface) and sets req.user.
 */
function authenticate(db) {
  return (req, _res, next) => {
    const h = req.get('authorization') || '';
    const token = /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, '').trim() : (req.cookies && req.cookies[COOKIE]);
    if (!token) return next();
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const row = db.prepare('SELECT id,email,name,role,password_hash FROM users WHERE id=?').get(payload.sub);
      if (row && payload.pv === pwStamp(row.password_hash)) {
        req.user = { id: row.id, email: row.email, name: row.name, role: row.role };
      }
    } catch (_e) { /* invalid or expired token: treated as signed out */ }
    next();
  };
}
function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'You must sign in.'));
  next();
}
function requireManager(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'You must sign in.'));
  if (req.user.role !== 'manager') return next(new HttpError(403, 'Only a manager can do this.'));
  next();
}

const ROLE_LABEL = { manager: 'Manager', receptionist: 'Receptionist' };

/**
 * Signs in with email and password. If the person picked a role on the sign-in screen, it must match the
 * account's role. The check runs only after the password is correct, so it reveals nothing to outsiders.
 */
function login(db, email, password, role) {
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').trim().toLowerCase());
  const ok = bcrypt.compareSync(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Wrong email or password.');
  if (role !== undefined && role !== null && role !== '') {
    if (!ROLES.includes(role)) throw new HttpError(400, 'Role must be manager or receptionist.');
    if (user.role !== role) {
      throw new HttpError(403, `This is a ${ROLE_LABEL[user.role]} account. Select "${ROLE_LABEL[user.role]}" to sign in.`);
    }
  }
  return user;
}
function changePassword(db, userId, current, next) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!bcrypt.compareSync(String(current || ''), user.password_hash)) throw new HttpError(400, 'The current password is not correct.');
  if (!validPassword(next)) throw new HttpError(400, 'The new password must be at least 10 characters long.');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(next), userId);
}

module.exports = { COOKIE, ROLES, authenticate, requireAuth, requireManager, login, issueToken, setCookie, createUser, changePassword, hashPassword, validPassword };
