/**
 * Beach umbrellas. The hotel has a fixed number of umbrellas (39 by default), numbered 1..N.
 * A booking gives one umbrella to one person for a range of days (from..to, both included).
 * The person is either a hotel guest (linked to a reservation, so the room number is shown)
 * or someone else, identified by first and last name.
 */
const { HttpError } = require('./errors');
const Pricing = require('../public/pricing.js');
const { uid, nowIso, str, int, log } = require('./util');

const MAX_DAYS = 60;

function total(db) {
  const r = db.prepare("SELECT value FROM settings WHERE key='beach_umbrellas'").get();
  return r ? Number(r.value) : 39;
}

const BOOKING_SQL = `
  SELECT b.id, b.spot, b.from_date, b.to_date, b.guest_name, b.notes, b.reservation_id, b.created_at,
         r.room_id, r.status AS res_status, u.name AS created_by
  FROM beach_bookings b
  LEFT JOIN reservations r ON r.id = b.reservation_id
  LEFT JOIN users u ON u.id = b.created_by`;

const shape = (b) => ({
  id: b.id, spot: b.spot, from: b.from_date, to: b.to_date, guestName: b.guest_name, notes: b.notes,
  reservationId: b.reservation_id, roomId: b.room_id || null, createdBy: b.created_by || null,
});

/** The state of every umbrella on one day. */
function day(db, date) {
  if (!Pricing.isDate(date)) throw new HttpError(400, 'The date is not valid.');
  const n = total(db);
  const rows = db.prepare(`${BOOKING_SQL} WHERE b.from_date <= ? AND b.to_date >= ? ORDER BY b.spot`).all(date, date);
  const bySpot = new Map(rows.map((b) => [b.spot, shape(b)]));
  const spots = [];
  for (let i = 1; i <= n; i++) spots.push({ spot: i, booking: bySpot.get(i) || null });
  const taken = spots.filter((s) => s.booking).length;
  return { date, total: n, taken, free: n - taken, spots };
}

function create(db, user, b) {
  return db.transaction(() => {
    const n = total(db);
    const spot = int(b.spot, { min: 1, max: n, field: 'Umbrella number' });
    if (!Pricing.isDate(b.from)) throw new HttpError(400, 'The dates are not valid.');
    const to = b.to === undefined || b.to === null || b.to === '' ? b.from : b.to;
    if (!Pricing.isDate(to)) throw new HttpError(400, 'The dates are not valid.');
    if (to < b.from) throw new HttpError(400, 'The end date cannot be before the start date.');
    if (Pricing.diffDays(b.from, to) + 1 > MAX_DAYS) throw new HttpError(400, `An umbrella cannot be booked for more than ${MAX_DAYS} days at a time.`);
    const notes = str(b.notes ?? '', { max: 200, field: 'Note' });

    let guestName;
    let reservationId = null;
    if (b.reservationId) {
      const r = db.prepare('SELECT r.id, r.arr, r.dep, r.status, g.name FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.id = ?').get(String(b.reservationId));
      if (!r) throw new HttpError(400, 'The reservation does not exist.');
      if (!['confirmed', 'checkedin'].includes(r.status)) throw new HttpError(409, 'Only guests with an active reservation can be linked to their room.');
      if (b.from < r.arr || to > r.dep) throw new HttpError(409, `The beach dates must fall within the stay (${r.arr} to ${r.dep}).`);
      guestName = r.name;
      reservationId = r.id;
    } else {
      guestName = str(b.guestName, { max: 120, min: 1, field: 'Guest name' });
    }

    const clash = db.prepare('SELECT guest_name, from_date, to_date FROM beach_bookings WHERE spot = ? AND from_date <= ? AND to_date >= ?').get(spot, to, b.from);
    if (clash) throw new HttpError(409, `Umbrella ${spot} is already taken by ${clash.guest_name} (${clash.from_date} to ${clash.to_date}).`);

    const id = uid();
    db.prepare('INSERT INTO beach_bookings (id,spot,from_date,to_date,guest_name,reservation_id,notes,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, spot, b.from, to, guestName, reservationId, notes, nowIso(), user.id);
    log(db, user, 'beach.assign', 'umbrella', String(spot), { from: b.from, to, guest: guestName, reservationId });
    return id;
  })();
}

function release(db, user, id) {
  const b = db.prepare('SELECT * FROM beach_bookings WHERE id = ?').get(id);
  if (!b) throw new HttpError(404, 'Umbrella booking not found.');
  db.prepare('DELETE FROM beach_bookings WHERE id = ?').run(id);
  log(db, user, 'beach.release', 'umbrella', String(b.spot), { from: b.from_date, to: b.to_date, guest: b.guest_name });
}

/** Changes the number of umbrellas (manager). Refuses if a removed umbrella still has current or future bookings. */
function setTotal(db, n, todayStr) {
  const busy = db.prepare('SELECT spot, guest_name FROM beach_bookings WHERE spot > ? AND to_date >= ? ORDER BY spot LIMIT 1').get(n, todayStr);
  if (busy) throw new HttpError(409, `Umbrella ${busy.spot} (${busy.guest_name}) still has a booking. Release it before reducing the number of umbrellas.`);
  db.prepare("INSERT INTO settings (key,value) VALUES ('beach_umbrellas', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(n));
}

module.exports = { total, day, create, release, setTotal };
