/**
 * Bar and restaurant. Staff take an order from the menu and either:
 *  - charge it to the room of a guest who is checked in (it is added to the guest's bill and paid at check-out), or
 *  - settle it on the spot with cash or card (walk-in guests, beach and terrace customers, etc.).
 * Prices are always read from the menu on the server, never trusted from the browser.
 */
const { HttpError } = require('./errors');
const Pricing = require('../public/pricing.js');
const { uid, nowIso, today, str, int, log } = require('./util');

const OUTLETS = ['bar', 'restaurant'];
const OUTLET_LABEL = { bar: 'Bar', restaurant: 'Restaurant' };

/* ---------- orders ---------- */
function createOrder(db, user, b, tz) {
  return db.transaction(() => {
    if (!OUTLETS.includes(b.outlet)) throw new HttpError(400, 'Choose the bar or the restaurant.');
    if (!Array.isArray(b.items) || b.items.length === 0) throw new HttpError(400, 'Add at least one item to the order.');
    if (b.items.length > 40) throw new HttpError(400, 'Too many different items in one order.');

    const lines = [];
    let total = 0;
    const seen = new Set();
    for (const it of b.items) {
      const id = String(it && it.id);
      if (seen.has(id)) throw new HttpError(400, 'The same item appears twice in the order.');
      seen.add(id);
      const qty = int(it.qty, { min: 1, max: 50, field: 'Quantity' });
      const m = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
      if (!m || m.outlet !== b.outlet) throw new HttpError(400, 'An item in the order is not on this menu.');
      if (!m.active) throw new HttpError(409, `"${m.name}" is not available at the moment.`);
      lines.push({ name: m.name, price: m.price, qty });
      total += m.price * qty;
    }

    const note = str(b.note ?? '', { max: 200, field: 'Note' });
    let label = str(b.label ?? '', { max: 60, field: 'Table or name' });
    let status;
    let reservationId = null;
    let method = null;
    if (b.destination === 'room') {
      const r = db.prepare("SELECT r.id, r.room_id, r.status, g.name FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.id = ?").get(String(b.reservationId));
      if (!r) throw new HttpError(400, 'Choose the guest whose room is charged.');
      if (r.status !== 'checkedin') throw new HttpError(409, 'Only guests who are checked in can charge to their room.');
      status = 'room';
      reservationId = r.id;
      label = label || `Room ${r.room_id}`;
    } else if (b.destination === 'paid') {
      if (!['cash', 'card'].includes(b.method)) throw new HttpError(400, 'Choose cash or card.');
      status = 'paid';
      method = b.method;
    } else {
      throw new HttpError(400, 'Choose whether to charge the room or to pay now.');
    }

    const id = uid();
    db.prepare(`INSERT INTO orders (id,outlet,reservation_id,label,total,status,method,note,day,created_at,created_by)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, b.outlet, reservationId, label, total, status, method, note, today(tz), nowIso(), user.id);
    const ins = db.prepare('INSERT INTO order_items (order_id,name,price,qty) VALUES (?,?,?,?)');
    for (const l of lines) ins.run(id, l.name, l.price, l.qty);
    log(db, user, 'order.create', 'order', id, { outlet: b.outlet, total, status, reservationId });
    return { id, total, status };
  })();
}

/** Voids an order (manager only, enforced in the route). A room charge can only be voided while the guest is still in the hotel. */
function voidOrder(db, user, id) {
  return db.transaction(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!o) throw new HttpError(404, 'Order not found.');
    if (o.status === 'void') throw new HttpError(409, 'This order is already voided.');
    if (o.status === 'room') {
      const r = db.prepare('SELECT status FROM reservations WHERE id = ?').get(o.reservation_id);
      if (!r || r.status !== 'checkedin') throw new HttpError(409, 'The guest has already checked out, so this charge can no longer be voided.');
    }
    db.prepare("UPDATE orders SET status='void', voided_by=? WHERE id=?").run(user.id, id);
    log(db, user, 'order.void', 'order', id, { total: o.total, outlet: o.outlet });
  })();
}

/** Orders of one day (optionally one outlet) with their items and totals. */
function listOrders(db, { date, outlet }) {
  if (!Pricing.isDate(date)) throw new HttpError(400, 'The date is not valid.');
  if (outlet !== undefined && !OUTLETS.includes(outlet)) throw new HttpError(400, 'Unknown outlet.');
  const rows = db.prepare(`
    SELECT o.*, u.name AS staff, r.room_id, g.name AS guest_name
    FROM orders o
    LEFT JOIN users u ON u.id = o.created_by
    LEFT JOIN reservations r ON r.id = o.reservation_id
    LEFT JOIN guests g ON g.id = r.guest_id
    WHERE o.day = ? ${outlet ? 'AND o.outlet = ?' : ''}
    ORDER BY o.created_at DESC`).all(...(outlet ? [date, outlet] : [date]));
  const itemsOf = db.prepare('SELECT name, price, qty FROM order_items WHERE order_id = ? ORDER BY id');
  const orders = rows.map((o) => ({
    id: o.id, outlet: o.outlet, status: o.status, method: o.method, total: o.total, label: o.label, note: o.note,
    at: o.created_at, staff: o.staff || null, reservationId: o.reservation_id, roomId: o.room_id || null, guestName: o.guest_name || null,
    items: itemsOf.all(o.id),
  }));
  const totals = { room: 0, cash: 0, card: 0, count: 0 };
  for (const o of orders) {
    if (o.status === 'void') continue;
    totals.count += 1;
    if (o.status === 'room') totals.room += o.total; else if (o.method === 'card') totals.card += o.total; else totals.cash += o.total;
  }
  return { date, orders, totals };
}

/* ---------- menu (manager only, enforced in the routes) ---------- */
function menuFields(b) {
  if (!OUTLETS.includes(b.outlet)) throw new HttpError(400, 'Choose the bar or the restaurant.');
  return {
    outlet: b.outlet,
    section: str(b.section ?? '', { max: 40, field: 'Section' }),
    name: str(b.name, { max: 80, min: 1, field: 'Item name' }),
    price: int(b.price, { min: 0, max: 1000000, field: 'Price' }),
    active: b.active === undefined ? 1 : (b.active ? 1 : 0),
  };
}
function createMenuItem(db, user, b) {
  const f = menuFields(b);
  const id = uid();
  db.prepare('INSERT INTO menu_items (id,outlet,section,name,price,active) VALUES (?,?,?,?,?,?)').run(id, f.outlet, f.section, f.name, f.price, f.active);
  log(db, user, 'menu.create', 'menu_item', id, { name: f.name, price: f.price });
  return { id };
}
function updateMenuItem(db, user, id, b) {
  const cur = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
  if (!cur) throw new HttpError(404, 'Menu item not found.');
  const f = menuFields({ outlet: cur.outlet, section: cur.section, name: cur.name, price: cur.price, active: !!cur.active, ...b, outlet: cur.outlet });
  db.prepare('UPDATE menu_items SET section=?,name=?,price=?,active=? WHERE id=?').run(f.section, f.name, f.price, f.active, id);
  log(db, user, 'menu.update', 'menu_item', id, { name: f.name, price: f.price, active: !!f.active });
}
function deleteMenuItem(db, user, id) {
  const r = db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
  if (!r.changes) throw new HttpError(404, 'Menu item not found.');
  log(db, user, 'menu.delete', 'menu_item', id);
}

module.exports = { OUTLETS, OUTLET_LABEL, createOrder, voidOrder, listOrders, createMenuItem, updateMenuItem, deleteMenuItem };
