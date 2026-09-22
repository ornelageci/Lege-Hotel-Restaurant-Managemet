/**
 * Business logic. All rules (conflicts, capacity, payments, check-in/out)
 * are enforced here on the server, not in the browser.
 */
const Pricing = require('../public/pricing.js');
const { HttpError } = require('./errors');
const beach = require('./beach');
const { uid, nowIso, today, str, int, log, EMAIL_RE } = require('./util');
const cfgTz = () => require('./config').tz;

const SOURCES = ['Direct', 'Phone', 'Booking.com', 'Airbnb', 'Agency', 'Other'];
const REQ_TYPES = ['Transport', 'Restaurant', 'Room service', 'Excursion', 'Other'];
const PAY_METHODS = ['cash', 'card', 'transfer'];


/* ---------- prices ---------- */
function loadPricing(db) {
  const cats = {};
  for (const c of db.prepare('SELECT * FROM categories').all()) cats[c.key] = { name: c.name, cap: c.cap, inc: c.inc, extra: c.extra };
  const prices = {};
  for (const k of Object.keys(cats)) prices[k] = { def: 0, m: {} };
  for (const p of db.prepare('SELECT * FROM prices').all()) {
    if (p.month === -1) prices[p.cat].def = p.amount; else prices[p.cat].m[p.month] = p.amount;
  }
  return { cats, prices };
}
function reservationTotal(db, res, P = loadPricing(db)) {
  const room = db.prepare('SELECT cat FROM rooms WHERE id=?').get(res.room_id || res.roomId);
  return Pricing.totalWith(P, room.cat, { arr: res.arr, dep: res.dep, adults: res.adults, custom: res.custom });
}
const paidOf = (db, id) => db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE reservation_id=?').get(id).s;
/** Bar and restaurant orders charged to the room of this reservation (voided orders excluded). */
const chargesOf = (db, id) => db.prepare("SELECT COALESCE(SUM(total),0) AS s FROM orders WHERE reservation_id=? AND status='room'").get(id).s;
/** Everything the guest owes: the stay plus room charges. */
const grandTotal = (db, res, P = loadPricing(db)) => reservationTotal(db, res, P) + chargesOf(db, res.id);

/* ---------- full state (for the frontend) ---------- */
function getState(db, user, extras = {}) {
  const P = loadPricing(db);
  const settings = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map((r) => [r.key, r.value]));
  const pays = db.prepare('SELECT reservation_id, amount, method, at FROM payments ORDER BY at').all();
  const paysBy = {};
  for (const p of pays) (paysBy[p.reservation_id] ||= []).push({ amount: p.amount, method: p.method, at: p.at });
  // Room charges (bar / restaurant) per reservation, with their items.
  const chargeRows = db.prepare("SELECT id, reservation_id, outlet, total, created_at FROM orders WHERE status='room' ORDER BY created_at").all();
  const itemRows = db.prepare("SELECT i.order_id, i.name, i.price, i.qty FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status='room'").all();
  const itemsBy = {};
  for (const i of itemRows) (itemsBy[i.order_id] ||= []).push({ name: i.name, price: i.price, qty: i.qty });
  const chargesBy = {};
  for (const c of chargeRows) {
    (chargesBy[c.reservation_id] ||= []).push({ id: c.id, outlet: c.outlet, total: c.total, at: c.created_at, items: itemsBy[c.id] || [] });
  }
  return {
    me: { id: user.id, name: user.name, email: user.email, role: user.role },
    hotel: settings.hotel_name,
    fx: Number(settings.fx),
    today: today(extras.tz || 'Europe/Tirane'),
    mailEnabled: !!extras.mailEnabled,
    beachUmbrellas: Number(settings.beach_umbrellas || 39),
    cats: P.cats,
    prices: P.prices,
    rooms: db.prepare('SELECT id,floor,cat,dirty FROM rooms ORDER BY id').all().map((r) => ({ ...r, dirty: !!r.dirty })),
    guests: db.prepare('SELECT * FROM guests ORDER BY name').all().map((g) => ({
      id: g.id, name: g.name, phone: g.phone, email: g.email, notes: g.notes, points: g.points, visits: g.visits, prefs: JSON.parse(g.prefs),
    })),
    res: db.prepare('SELECT * FROM reservations').all().map((r) => {
      const list = paysBy[r.id] || [];
      const charges = chargesBy[r.id] || [];
      return {
        id: r.id, guestId: r.guest_id, roomId: r.room_id, arr: r.arr, dep: r.dep, status: r.status, source: r.source,
        adults: r.adults, custom: r.custom, notes: r.notes, paid: list.reduce((s, p) => s + p.amount, 0), pays: list,
        charges, chargesTotal: charges.reduce((s, c) => s + c.total, 0),
      };
    }),
    reqs: db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all().map((q) => ({
      id: q.id, guestId: q.guest_id, type: q.type, note: q.note, done: !!q.done, day: q.day,
    })),
    menu: db.prepare('SELECT id,outlet,section,name,price,active FROM menu_items ORDER BY outlet, section, name').all()
      .map((m) => ({ ...m, active: !!m.active })),
  };
}

/* ---------- reservations ---------- */
function findConflict(db, { roomId, arr, dep, ignoreId }) {
  return db.prepare(`
    SELECT r.arr, r.dep, g.name FROM reservations r JOIN guests g ON g.id = r.guest_id
    WHERE r.room_id = ? AND r.status != 'cancelled' AND r.arr < ? AND r.dep > ? AND r.id != ?`)
    .get(roomId, dep, arr, ignoreId || '');
}

function parseReservation(db, b) {
  const guestName = str(b.guestName, { max: 120, min: 1, field: 'Guest name' });
  const phone = str(b.phone ?? '', { max: 40, field: 'Phone' });
  const email = str(b.email ?? '', { max: 120, field: 'Email' });
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'The guest email address is not valid.');
  const notes = str(b.notes ?? '', { max: 500, field: 'Special requests' });
  const source = SOURCES.includes(b.source) ? b.source : 'Direct';
  const room = db.prepare('SELECT r.id, r.cat, c.cap, c.name AS catName FROM rooms r JOIN categories c ON c.key = r.cat WHERE r.id = ?').get(String(b.roomId));
  if (!room) throw new HttpError(400, 'The room does not exist.');
  const adults = int(b.adults, { min: 1, max: 50, field: 'Number of people' });
  if (adults > room.cap) throw new HttpError(400, `Room ${room.id} accepts up to ${room.cap} people.`);
  if (!Pricing.isDate(b.arr) || !Pricing.isDate(b.dep)) throw new HttpError(400, 'The dates are not valid.');
  if (b.dep <= b.arr) throw new HttpError(400, 'Departure must be after arrival.');
  if (Pricing.diffDays(b.arr, b.dep) > 120) throw new HttpError(400, 'A stay cannot be longer than 120 nights.');
  const custom = int(b.custom ?? 0, { min: 0, max: 10000000, field: 'Custom price' });
  return { guestName, phone, email, notes, source, room, adults, arr: b.arr, dep: b.dep, custom };
}

function assertFree(db, f, ignoreId) {
  const c = findConflict(db, { roomId: f.room.id, arr: f.arr, dep: f.dep, ignoreId });
  if (c) throw new HttpError(409, `Room ${f.room.id} is already taken by ${c.name} (${c.arr} to ${c.dep}).`);
}

function resolveGuest(db, name, phone, email) {
  let g = db.prepare('SELECT * FROM guests WHERE name = ? COLLATE NOCASE').get(name);
  if (!g) {
    const id = uid();
    db.prepare('INSERT INTO guests (id,name,phone,email,created_at) VALUES (?,?,?,?,?)').run(id, name, phone, email || '', nowIso());
    g = { id };
  } else {
    if (phone) db.prepare('UPDATE guests SET phone=? WHERE id=?').run(phone, g.id);
    if (email) db.prepare('UPDATE guests SET email=? WHERE id=?').run(email, g.id);
  }
  return g.id;
}

function createReservation(db, user, b) {
  return db.transaction(() => {
    const f = parseReservation(db, b);
    assertFree(db, f, null);
    const guestId = resolveGuest(db, f.guestName, f.phone, f.email);
    const id = uid();
    db.prepare(`INSERT INTO reservations (id,guest_id,room_id,arr,dep,status,source,adults,custom,notes,created_at,created_by)
                VALUES (?,?,?,?,?,'confirmed',?,?,?,?,?,?)`)
      .run(id, guestId, f.room.id, f.arr, f.dep, f.source, f.adults, f.custom, f.notes, nowIso(), user.id);
    const deposit = int(b.deposit ?? 0, { min: 0, max: 100000000, field: 'Deposit' });
    if (deposit > 0) addPayment(db, user, id, { amount: deposit, method: 'cash' });
    log(db, user, 'reservation.create', 'reservation', id, { room: f.room.id, arr: f.arr, dep: f.dep, adults: f.adults });
    return id;
  })();
}

function getReservation(db, id) {
  const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (!r) throw new HttpError(404, 'Reservation not found.');
  return r;
}

function updateReservation(db, user, id, b) {
  return db.transaction(() => {
    const cur = getReservation(db, id);
    if (cur.status === 'checkedout') throw new HttpError(409, 'A closed reservation cannot be changed.');
    if (cur.status === 'cancelled') throw new HttpError(409, 'Restore the reservation before changing it.');
    const f = parseReservation(db, b);
    assertFree(db, f, id);
    const guestId = resolveGuest(db, f.guestName, f.phone, f.email);
    db.prepare('UPDATE reservations SET guest_id=?,room_id=?,arr=?,dep=?,source=?,adults=?,custom=?,notes=? WHERE id=?')
      .run(guestId, f.room.id, f.arr, f.dep, f.source, f.adults, f.custom, f.notes, id);
    log(db, user, 'reservation.update', 'reservation', id, { room: f.room.id, arr: f.arr, dep: f.dep });
  })();
}

function setStatus(db, user, id, action, cfg) {
  return db.transaction(() => {
    const r = getReservation(db, id);
    const P = loadPricing(db);
    const out = {};
    if (action === 'checkin') {
      if (r.status !== 'confirmed') throw new HttpError(409, 'Only a confirmed reservation can be checked in.');
      const room = db.prepare('SELECT dirty FROM rooms WHERE id=?').get(r.room_id);
      if (room.dirty) throw new HttpError(409, `Room ${r.room_id} has not been cleaned yet. Mark it as clean before check-in.`);
      db.prepare("UPDATE reservations SET status='checkedin' WHERE id=?").run(id);
    } else if (action === 'checkout') {
      if (r.status !== 'checkedin') throw new HttpError(409, 'Only a guest who is in the hotel can check out.');
      const t = today(cfg.tz);
      let dep = r.dep;
      if (r.arr < t && r.dep > t) dep = t; // early departure: the stay is shortened
      db.prepare("UPDATE reservations SET status='checkedout', dep=? WHERE id=?").run(dep, id);
      const total = reservationTotal(db, { ...r, dep }, P);
      const points = Math.round(total / 100);
      db.prepare('UPDATE guests SET points = points + ?, visits = visits + 1 WHERE id=?').run(points, r.guest_id);
      db.prepare('UPDATE rooms SET dirty=1 WHERE id=?').run(r.room_id);
      out.points = points;
      out.shortened = dep !== r.dep;
      out.balance = Math.max(0, total + chargesOf(db, id) - paidOf(db, id));   // still unpaid at check-out
    } else if (action === 'cancel') {
      if (r.status !== 'confirmed') throw new HttpError(409, 'Only a confirmed reservation can be cancelled.');
      db.prepare("UPDATE reservations SET status='cancelled' WHERE id=?").run(id);
    } else if (action === 'restore') {
      if (r.status !== 'cancelled') throw new HttpError(409, 'This reservation is not cancelled.');
      const c = findConflict(db, { roomId: r.room_id, arr: r.arr, dep: r.dep, ignoreId: id });
      if (c) throw new HttpError(409, `Cannot restore: the room has been taken by ${c.name}.`);
      db.prepare("UPDATE reservations SET status='confirmed' WHERE id=?").run(id);
    }
    log(db, user, `reservation.${action}`, 'reservation', id, out);
    return out;
  })();
}

function addPayment(db, user, reservationId, b) {
  const r = getReservation(db, reservationId);
  if (r.status === 'cancelled') throw new HttpError(409, 'The reservation is cancelled.');
  const amount = int(b.amount, { min: 1, max: 100000000, field: 'Amount' });
  if (!PAY_METHODS.includes(b.method)) throw new HttpError(400, 'The payment method is not valid.');
  const total = grandTotal(db, r);   // stay + bar/restaurant charges
  const paid = paidOf(db, reservationId);
  if (paid + amount > total) throw new HttpError(409, `The amount exceeds what is owed. ${total - paid} lek remain to be paid.`);
  db.prepare('INSERT INTO payments (id,reservation_id,amount,method,at,user_id) VALUES (?,?,?,?,?,?)')
    .run(uid(), reservationId, amount, b.method, nowIso(), user.id);
  log(db, user, 'payment.add', 'reservation', reservationId, { amount, method: b.method });
}

/* ---------- rooms, guests, requests ---------- */
function setRoomDirty(db, user, roomId, dirty) {
  const room = db.prepare('SELECT id FROM rooms WHERE id=?').get(roomId);
  if (!room) throw new HttpError(404, 'Room not found.');
  if (dirty && db.prepare("SELECT 1 FROM reservations WHERE room_id=? AND status='checkedin'").get(roomId)) {
    throw new HttpError(409, 'The room has a guest inside.');
  }
  db.prepare('UPDATE rooms SET dirty=? WHERE id=?').run(dirty ? 1 : 0, roomId);
  log(db, user, dirty ? 'room.dirty' : 'room.clean', 'room', roomId);
}

function updateGuest(db, user, id, b) {
  const g = db.prepare('SELECT * FROM guests WHERE id=?').get(id);
  if (!g) throw new HttpError(404, 'Guest not found.');
  const notes = b.notes !== undefined ? str(b.notes, { max: 2000, field: 'Note' }) : g.notes;
  const phone = b.phone !== undefined ? str(b.phone, { max: 40, field: 'Phone' }) : g.phone;
  const email = b.email !== undefined ? str(b.email, { max: 120, field: 'Email' }) : g.email;
  let prefs = JSON.parse(g.prefs);
  if (b.prefs !== undefined) {
    if (!Array.isArray(b.prefs) || b.prefs.length > 30) throw new HttpError(400, 'The preferences are not valid.');
    prefs = b.prefs.map((p) => str(p, { max: 60, min: 1, field: 'Preference' }));
  }
  db.prepare('UPDATE guests SET notes=?,phone=?,email=?,prefs=? WHERE id=?').run(notes, phone, email, JSON.stringify(prefs), id);
  log(db, user, 'guest.update', 'guest', id);
}

function createRequest(db, user, b) {
  const g = db.prepare('SELECT id FROM guests WHERE id=?').get(String(b.guestId));
  if (!g) throw new HttpError(400, 'The guest does not exist.');
  const type = REQ_TYPES.includes(b.type) ? b.type : 'Other';
  const note = str(b.note, { max: 300, min: 1, field: 'Request details' });
  const id = uid();
  db.prepare('INSERT INTO requests (id,guest_id,type,note,done,day,created_at) VALUES (?,?,?,?,0,?,?)')
    .run(id, g.id, type, note, new Date().toISOString().slice(0, 10), nowIso());
  log(db, user, 'request.create', 'request', id, { type });
}
function completeRequest(db, user, id) {
  const r = db.prepare('UPDATE requests SET done=1 WHERE id=?').run(id);
  if (!r.changes) throw new HttpError(404, 'Request not found.');
  log(db, user, 'request.done', 'request', id);
}

/* ---------- prices and settings (manager only) ---------- */
function updateSettings(db, user, b) {
  db.transaction(() => {
    if (b.fx !== undefined) {
      const fx = Number(b.fx);
      if (!(fx >= 1 && fx <= 10000)) throw new HttpError(400, 'The exchange rate is not valid.');
      db.prepare("UPDATE settings SET value=? WHERE key='fx'").run(String(fx));
    }
    if (b.hotelName !== undefined) {
      db.prepare("UPDATE settings SET value=? WHERE key='hotel_name'").run(str(b.hotelName, { max: 80, min: 1, field: 'Hotel name' }));
    }
    if (b.beachUmbrellas !== undefined) beach.setTotal(db, int(b.beachUmbrellas, { min: 1, max: 500, field: 'Number of umbrellas' }), today(cfgTz()));
    log(db, user, 'settings.update', 'settings', null, { fx: b.fx, hotelName: b.hotelName, beachUmbrellas: b.beachUmbrellas });
  })();
}
function updateCategory(db, user, key, b) {
  const c = db.prepare('SELECT * FROM categories WHERE key=?').get(key);
  if (!c) throw new HttpError(404, 'Category not found.');
  const name = b.name !== undefined ? str(b.name, { max: 60, min: 1, field: 'Name' }) : c.name;
  const cap = b.cap !== undefined ? int(b.cap, { min: 1, max: 50, field: 'Capacity' }) : c.cap;
  const inc = b.inc !== undefined ? int(b.inc, { min: 1, max: 50, field: 'People included' }) : c.inc;
  const extra = b.extra !== undefined ? int(b.extra, { min: 0, max: 10000000, field: 'Price per extra person' }) : c.extra;
  if (inc > cap) throw new HttpError(400, 'People included cannot be more than the capacity.');
  db.prepare('UPDATE categories SET name=?,cap=?,inc=?,extra=? WHERE key=?').run(name, cap, inc, extra, key);
  log(db, user, 'category.update', 'category', key, { name, cap, inc, extra });
}
function setPrice(db, user, b) {
  if (!db.prepare('SELECT 1 FROM categories WHERE key=?').get(String(b.cat))) throw new HttpError(400, 'The category does not exist.');
  const month = b.month === 'def' ? -1 : int(b.month, { min: 0, max: 11, field: 'Month' });
  if (b.amount === null || b.amount === '' || b.amount === undefined) {
    if (month === -1) throw new HttpError(400, 'The base price cannot be removed.');
    db.prepare('DELETE FROM prices WHERE cat=? AND month=?').run(b.cat, month);
  } else {
    const amount = int(b.amount, { min: 0, max: 10000000, field: 'Price' });
    db.prepare('INSERT INTO prices (cat,month,amount) VALUES (?,?,?) ON CONFLICT(cat,month) DO UPDATE SET amount=excluded.amount').run(b.cat, month, amount);
  }
  log(db, user, 'price.set', 'price', `${b.cat}:${month}`, { amount: b.amount });
}

/**
 * Saves a whole pricing form at once (the "Save" button): exchange rate, categories and prices.
 * Everything is applied in one transaction, so either all changes are saved or none.
 * body: { fx?, categories?: { key: { name?, cap?, inc?, extra? } }, prices?: [{ cat, month, amount }] }
 */
function savePricing(db, user, b) {
  const cats = b.categories && typeof b.categories === 'object' ? b.categories : {};
  const prices = Array.isArray(b.prices) ? b.prices : [];
  if (prices.length > 500) throw new HttpError(400, 'Too many price changes in one request.');
  db.transaction(() => {
    if (b.fx !== undefined) updateSettings(db, user, { fx: b.fx });
    for (const [key, v] of Object.entries(cats)) updateCategory(db, user, key, v || {});
    for (const p of prices) setPrice(db, user, p || {});
  })();
}

function recentActivity(db, limit = 100) {
  return db.prepare(`SELECT a.at, a.action, a.entity, a.entity_id, a.detail, u.name AS user
                     FROM activity a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?`).all(limit);
}

module.exports = {
  log, today, getState, createReservation, updateReservation, setStatus, addPayment, setRoomDirty, updateGuest,
  createRequest, completeRequest, updateSettings, updateCategory, setPrice, savePricing, recentActivity, loadPricing,
  reservationTotal, grandTotal, chargesOf, paidOf, EMAIL_RE, SOURCES, uid, nowIso, str, int,
};
