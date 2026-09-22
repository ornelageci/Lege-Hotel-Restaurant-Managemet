/** User management (manager only). */
const auth = require('./auth');
const svc = require('./service');
const { HttpError } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function listUsers(db) {
  return db.prepare('SELECT id,email,name,role,created_at FROM users ORDER BY name').all();
}

function createUser(db, actor, b) {
  const email = String(b.email || '').trim().toLowerCase();
  const name = String(b.name || '').trim();
  if (!EMAIL_RE.test(email) || email.length > 120) throw new HttpError(400, 'The email address is not valid.');
  if (name.length < 1 || name.length > 80) throw new HttpError(400, 'Name is required (maximum 80 characters).');
  let id;
  try {
    id = auth.createUser(db, { email, name, password: b.password, role: b.role });
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) throw new HttpError(409, 'This email already exists.');
    throw e;
  }
  svc.log(db, actor, 'user.create', 'user', id, { email, role: b.role });
  return { id };
}

const managerCount = (db) => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='manager'").get().n;

function updateUser(db, actor, id, b) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) throw new HttpError(404, 'User not found.');
  const role = b.role !== undefined ? b.role : u.role;
  if (!auth.ROLES.includes(role)) throw new HttpError(400, 'Role must be manager or receptionist.');
  const name = b.name !== undefined ? String(b.name).trim() : u.name;
  if (name.length < 1 || name.length > 80) throw new HttpError(400, 'Name is required (maximum 80 characters).');
  if (u.role === 'manager' && role !== 'manager' && managerCount(db) <= 1) {
    throw new HttpError(409, 'At least one manager must remain.');
  }
  db.prepare('UPDATE users SET name=?, role=? WHERE id=?').run(name, role, id);
  svc.log(db, actor, 'user.update', 'user', id, { role });
}

function resetPassword(db, actor, id, password) {
  if (!auth.validPassword(password)) throw new HttpError(400, 'The password must be at least 10 characters long.');
  const r = db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(auth.hashPassword(password), id);
  if (!r.changes) throw new HttpError(404, 'User not found.');
  svc.log(db, actor, 'user.password_reset', 'user', id);
}

function deleteUser(db, actor, id) {
  if (id === actor.id) throw new HttpError(409, 'You cannot delete your own account.');
  const u = db.prepare('SELECT role FROM users WHERE id=?').get(id);
  if (!u) throw new HttpError(404, 'User not found.');
  if (u.role === 'manager' && managerCount(db) <= 1) throw new HttpError(409, 'At least one manager must remain.');
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  svc.log(db, actor, 'user.delete', 'user', id);
}

module.exports = { listUsers, createUser, updateUser, resetPassword, deleteUser };
