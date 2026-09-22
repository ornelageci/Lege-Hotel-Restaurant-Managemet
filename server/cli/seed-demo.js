/*
 * DEMO data for testing (fictional guests and reservations, dated around today).
 * Usage: npm run seed-demo. Runs only if there are no reservations yet.
 */
const crypto = require('crypto');
const config = require('../config');
const dbLib = require('../db');
const svc = require('../service');
const Pricing = require('../../public/pricing.js');
const beach = require('../beach');
const pos = require('../pos');

const db = dbLib.open(config.dbPath, config.hotelName);
if (db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n > 0) {
  console.error('The database already has reservations. The demo seed did not run.');
  process.exit(1);
}
const t = svc.today(config.tz);
const day = (n) => Pricing.addDays(t, n);
const now = () => new Date().toISOString();
const P = svc.loadPricing(db);

const guests = [
  ['Arben Krasniqi', 1820, 9], ['Jean Dupont', 2210, 11], ['Hans Weber', 1120, 5], ['Elena Rossi', 840, 4],
  ['Ilir Berisha', 320, 3], ['Sofia Nilsson', 260, 2], ['Klea Doçi', 90, 1], ['Marco Ferri', 610, 4],
  ['Ana Petrova', 150, 1], ['Valmir Hysa', 980, 5], ['Lena Larsen', 0, 0], ['Yuki Tanaka', 700, 3],
  ['Blerta Mehmeti', 120, 1], ['Tomas Novak', 410, 2], ['Carla Ruiz', 80, 1], ['Omar Haddad', 470, 2], ['Petra Schmidt', 1340, 6],
];
const gid = {};
const insG = db.prepare('INSERT INTO guests (id,name,points,visits,created_at) VALUES (?,?,?,?,?)');
for (const [n, p, v] of guests) { gid[n] = crypto.randomUUID(); insG.run(gid[n], n, p, v, now()); }

// [guest, room, arrival, departure, status, source, people, share paid]
const rows = [
  ['Sofia Nilsson', '101', -1, 2, 'checkedin', 'Airbnb', 2, 1], ['Klea Doçi', '102', 1, 3, 'confirmed', 'Direct', 2, .5],
  ['Lena Larsen', '103', 5, 7, 'confirmed', 'Booking.com', 2, 0], ['Blerta Mehmeti', '105', -1, 2, 'checkedin', 'Airbnb', 2, 1],
  ['Tomas Novak', '106', -3, 1, 'checkedin', 'Booking.com', 1, 1], ['Carla Ruiz', '107', 0, 2, 'confirmed', 'Direct', 2, 0],
  ['Marco Ferri', '108', -1, 0, 'checkedin', 'Phone', 1, .6], ['Yuki Tanaka', '109', 2, 5, 'confirmed', 'Agency', 2, .5],
  ['Ana Petrova', '201', 0, 4, 'confirmed', 'Booking.com', 4, 0], ['Valmir Hysa', '202', 3, 6, 'confirmed', 'Direct', 6, .3],
  ['Ilir Berisha', '203', -2, 3, 'checkedin', 'Direct', 5, .4], ['Arben Krasniqi', '204', -2, 1, 'checkedin', 'Direct', 3, .5],
  ['Jean Dupont', '206', -3, 0, 'checkedin', 'Direct', 2, 1], ['Petra Schmidt', '207', 1, 4, 'confirmed', 'Direct', 8, .4],
  ['Omar Haddad', '208', -1, 3, 'checkedin', 'Direct', 4, .5], ['Elena Rossi', '209', 0, 3, 'confirmed', 'Booking.com', 6, 0],
  ['Hans Weber', '210', 0, 2, 'confirmed', 'Direct', 3, .5],
];
const insR = db.prepare(`INSERT INTO reservations (id,guest_id,room_id,arr,dep,status,source,adults,custom,notes,created_at)
                         VALUES (?,?,?,?,?,?,?,?,0,'',?)`);
const insP = db.prepare('INSERT INTO payments (id,reservation_id,amount,method,at) VALUES (?,?,?,?,?)');
db.transaction(() => {
  for (const [g, room, a, d, status, src, ad, pct] of rows) {
    const id = crypto.randomUUID();
    const arr = day(a), dep = day(d);
    insR.run(id, gid[g], room, arr, dep, status, src, ad, now());
    const cat = db.prepare('SELECT cat FROM rooms WHERE id=?').get(room).cat;
    const total = Pricing.totalWith(P, cat, { arr, dep, adults: ad, custom: 0 });
    const paid = Math.round(total * pct / 100) * 100;
    if (paid > 0) insP.run(crypto.randomUUID(), id, Math.min(paid, total), 'cash', now());
  }
  db.prepare("UPDATE rooms SET dirty=1 WHERE id IN ('104','205')").run();
})();

// Beach umbrellas and bar / restaurant orders for the demo.
const sys = { id: null };
const resOf = (guest) => db.prepare('SELECT id, dep FROM reservations WHERE guest_id = ?').get(gid[guest]);
for (const [spot, guest] of [[3, 'Sofia Nilsson'], [4, 'Sofia Nilsson'], [12, 'Arben Krasniqi'], [13, 'Jean Dupont'], [20, 'Omar Haddad']]) {
  const r = resOf(guest);
  beach.create(db, sys, { spot, from: t, to: r.dep, reservationId: r.id });
}
for (const [spot, name] of [[1, 'Peter Hansen'], [2, 'Mira Koci'], [30, 'Daniel Moore']]) beach.create(db, sys, { spot, from: t, to: t, guestName: name });
const room = (guest) => resOf(guest).id;
pos.createOrder(db, sys, { outlet: 'bar', destination: 'room', reservationId: room('Jean Dupont'), items: [{ id: 'bar-spritz', qty: 2 }, { id: 'bar-water-still', qty: 1 }] }, config.tz);
pos.createOrder(db, sys, { outlet: 'restaurant', destination: 'room', reservationId: room('Omar Haddad'), items: [{ id: 'rest-seabass', qty: 2 }, { id: 'rest-greek', qty: 1 }] }, config.tz);
pos.createOrder(db, sys, { outlet: 'bar', destination: 'paid', method: 'cash', label: 'Terrace 4', items: [{ id: 'bar-espresso', qty: 3 }, { id: 'bar-beer-draft', qty: 1 }] }, config.tz);
console.log(`Added ${guests.length} guests and ${rows.length} demo reservations.`);
db.close();
