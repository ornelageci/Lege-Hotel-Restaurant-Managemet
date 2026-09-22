process.env.LOGIN_RATE_LIMIT = '1000';
process.env.CORS_ORIGINS = 'http://localhost:5173';
const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const config = require('../server/config');
const dbLib = require('../server/db');
const auth = require('../server/auth');
const svc = require('../server/service');
const Pricing = require('../public/pricing.js');
const { createApp } = require('../server/index');
const { createMailer } = require('../server/mailer');
const { createNotifier } = require('../server/notifications');

const PASSWORD = 'a-long-password-1';
let server, base, db, app;
const outbox = [];          // every email the app "sent"
let failMail = false;       // makes the fake SMTP server fail

async function call(method, path, body, cookie) {
  const res = await fetch(base + '/api' + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_e) { /* no body */ }
  return { status: res.status, data, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
async function loginAs(email) {
  const r = await call('POST', '/auth/login', { email, password: PASSWORD });
  assert.equal(r.status, 200);
  return r.cookie;
}
async function tokenFor(email, password = PASSWORD) {
  const r = await call('POST', '/auth/login', { email, password });
  assert.equal(r.status, 200);
  return r.data.token;
}
async function callBearer(method, path, body, token, extraHeaders = {}) {
  const res = await fetch(base + '/api' + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}`, ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_e) { /* no body */ }
  return { status: res.status, data, headers: res.headers };
}
const today = () => svc.today('Europe/Tirane');
const day = (n) => Pricing.addDays(today(), n);
const state = async (c) => (await call('GET', '/state', null, c)).data;
const flushMail = () => app.locals.notifier.flush();

test.before(async () => {
  db = dbLib.open(':memory:', 'Lege');
  auth.createUser(db, { email: 'admin@lege.al', name: 'Admin', password: PASSWORD, role: 'manager' });
  auth.createUser(db, { email: 'recepsion@lege.al', name: 'Recepsion', password: PASSWORD, role: 'receptionist' });
  // Real nodemailer message building, but nothing goes over the network.
  const json = nodemailer.createTransport({ jsonTransport: true });
  const transport = {
    sendMail: async (m) => {
      if (failMail) throw new Error('SMTP connection refused');
      const info = await json.sendMail(m);
      outbox.push({ ...m, raw: JSON.parse(info.message) });
      return info;
    },
  };
  app = createApp(db, { mailer: createMailer({ from: 'Lege Hotel <hotel@lege.al>' }, transport) });
  await new Promise((ok) => { server = app.listen(0, ok); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); db.close(); });

/* ---------------- basics ---------------- */

test('without signing in, the API returns 401', async () => {
  assert.equal((await call('GET', '/state')).status, 401);
});
test('signing in with a wrong password fails', async () => {
  const r = await call('POST', '/auth/login', { email: 'admin@lege.al', password: 'wrong' });
  assert.equal(r.status, 401);
});
test('the initial state has 20 rooms, September prices and the sample menu', async () => {
  const c = await loginAs('recepsion@lege.al');
  const data = await state(c);
  assert.equal(data.rooms.length, 20);
  assert.equal(data.rooms.filter((r) => r.floor === 1).length, 10);
  assert.equal(data.cats.dup.cap, 10);
  assert.equal(data.cats.dup.name, 'Family Duplex');
  assert.equal(data.prices.std.m[8], 7500);
  assert.equal(data.beachUmbrellas, 39);
  assert.ok(data.menu.some((m) => m.outlet === 'bar') && data.menu.some((m) => m.outlet === 'restaurant'));
  assert.ok(!('password_hash' in data.me));
});

/* ---------------- sign-in as manager or receptionist ---------------- */

test('sign-in with a chosen role: the right role works, the wrong role is told which one to pick', async () => {
  const ok = await call('POST', '/auth/login', { email: 'admin@lege.al', password: PASSWORD, role: 'manager' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.role, 'manager');
  const rec = await call('POST', '/auth/login', { email: 'recepsion@lege.al', password: PASSWORD, role: 'receptionist' });
  assert.equal(rec.data.user.role, 'receptionist');
  const wrong = await call('POST', '/auth/login', { email: 'recepsion@lege.al', password: PASSWORD, role: 'manager' });
  assert.equal(wrong.status, 403);
  assert.match(wrong.data.error, /Receptionist/);
  assert.equal(wrong.cookie, '', 'no session is created');
  assert.equal((await call('POST', '/auth/login', { email: 'admin@lege.al', password: PASSWORD, role: 'owner' })).status, 400);
  // a wrong password with any role never reveals the account role
  const bad = await call('POST', '/auth/login', { email: 'admin@lege.al', password: 'nope', role: 'receptionist' });
  assert.equal(bad.status, 401);
});

/* ---------------- reservations ---------------- */

test('new reservation, conflict and capacity', async () => {
  const c = await loginAs('recepsion@lege.al');
  const body = { guestName: 'Test Guest', roomId: '201', arr: day(10), dep: day(13), adults: 6, source: 'Direct' };
  const ok = await call('POST', '/reservations', body, c);
  assert.equal(ok.status, 200);
  const clash = await call('POST', '/reservations', { ...body, guestName: 'Other', arr: day(12), dep: day(14), adults: 2 }, c);
  assert.equal(clash.status, 409);
  const same = await call('POST', '/reservations', { ...body, guestName: 'Other', arr: day(13), dep: day(15), adults: 2 }, c);
  assert.equal(same.status, 200, 'a departure and an arrival on the same day are allowed');
  const big = await call('POST', '/reservations', { guestName: 'Too many', roomId: '101', arr: day(20), dep: day(21), adults: 3 }, c);
  assert.equal(big.status, 400, 'a standard room accepts only 2 people');
  const bad = await call('POST', '/reservations', { ...body, arr: day(5), dep: day(4) }, c);
  assert.equal(bad.status, 400);
  const badMail = await call('POST', '/reservations', { ...body, roomId: '202', email: 'not-an-email' }, c);
  assert.equal(badMail.status, 400);
});

test('full flow: payment, check-in blocked by dirty room, check-in, check-out, points', async () => {
  const c = await loginAs('recepsion@lege.al');
  db.prepare("UPDATE rooms SET dirty=1 WHERE id='105'").run();
  const { data: created } = await call('POST', '/reservations',
    { guestName: 'Flow Test', roomId: '105', arr: day(-2), dep: day(0), adults: 2, deposit: 3000 }, c);
  const id = created.id;

  const blocked = await call('POST', `/reservations/${id}/checkin`, null, c);
  assert.equal(blocked.status, 409, 'check-in in a dirty room is not allowed');
  await call('POST', '/rooms/105/clean', null, c);
  assert.equal((await call('POST', `/reservations/${id}/checkin`, null, c)).status, 200);

  const over = await call('POST', `/reservations/${id}/payments`, { amount: 999999, method: 'cash' }, c);
  assert.equal(over.status, 409, 'a payment above the total is not allowed');
  assert.equal((await call('POST', `/reservations/${id}/payments`, { amount: 12000, method: 'card' }, c)).status, 200);

  let st = await state(c);
  assert.equal(st.res.find((r) => r.id === id).paid, 15000, 'deposit 3,000 + 12,000 = 15,000 (2 nights × 7,500)');

  const out = await call('POST', `/reservations/${id}/checkout`, null, c);
  assert.equal(out.status, 200);
  assert.equal(out.data.points, 150, '15,000 lek = 150 points');
  assert.equal(out.data.balance, 0);
  st = await state(c);
  assert.equal(st.rooms.find((r) => r.id === '105').dirty, true, 'the room needs cleaning after check-out');
  const g = st.guests.find((x) => x.name === 'Flow Test');
  assert.equal(g.points, 150);
  assert.equal(g.visits, 1);
  const locked = await call('PATCH', `/reservations/${id}`,
    { guestName: 'Flow Test', roomId: '105', arr: day(-2), dep: day(2), adults: 2 }, c);
  assert.equal(locked.status, 409, 'a closed reservation cannot be changed');
});

test('early departure shortens the stay', async () => {
  const c = await loginAs('recepsion@lege.al');
  const { data } = await call('POST', '/reservations', { guestName: 'Shortened', roomId: '106', arr: day(-2), dep: day(3), adults: 2 }, c);
  await call('POST', `/reservations/${data.id}/checkin`, null, c);
  const out = await call('POST', `/reservations/${data.id}/checkout`, null, c);
  assert.equal(out.data.shortened, true);
  assert.equal(out.data.balance, 15000, 'two nights are still unpaid');
  const st = await state(c);
  assert.equal(st.res.find((r) => r.id === data.id).dep, today());
});

test('cancel and restore with a conflict check', async () => {
  const c = await loginAs('recepsion@lege.al');
  const a = (await call('POST', '/reservations', { guestName: 'Cancelled', roomId: '107', arr: day(30), dep: day(32), adults: 2 }, c)).data.id;
  assert.equal((await call('POST', `/reservations/${a}/cancel`, null, c)).status, 200);
  await call('POST', '/reservations', { guestName: 'Takes the room', roomId: '107', arr: day(30), dep: day(32), adults: 2 }, c);
  assert.equal((await call('POST', `/reservations/${a}/restore`, null, c)).status, 409);
});

/* ---------------- prices: one Save button ---------------- */

test('the receptionist cannot change prices, the manager can', async () => {
  const rec = await loginAs('recepsion@lege.al');
  const adm = await loginAs('admin@lege.al');
  assert.equal((await call('PUT', '/prices', { cat: 'std', month: 9, amount: 9000 }, rec)).status, 403);
  assert.equal((await call('PUT', '/pricing', { prices: [{ cat: 'std', month: 9, amount: 9000 }] }, rec)).status, 403);
  assert.equal((await call('PUT', '/prices', { cat: 'std', month: 9, amount: 9000 }, adm)).status, 200);
  assert.equal((await call('PUT', '/categories/dup', { extra: 3000 }, adm)).status, 200);
  assert.equal((await call('PUT', '/categories/dup', { inc: 11 }, adm)).status, 400, 'included people > capacity');
  assert.equal((await call('PUT', '/prices', { cat: 'std', month: 'def', amount: null }, adm)).status, 400);
  const st = await state(adm);
  assert.equal(st.prices.std.m[9], 9000);
  assert.equal(st.cats.dup.extra, 3000);
  assert.equal((await call('GET', '/activity', null, rec)).status, 403);
  assert.ok((await call('GET', '/activity', null, adm)).data.length > 0);
});

test('Save button: exchange rate, categories and prices are saved together in one request', async () => {
  const adm = await loginAs('admin@lege.al');
  const r = await call('PUT', '/pricing', {
    fx: 100,
    categories: { dup: { name: 'Family Duplex', cap: 10, inc: 2, extra: 3500 } },
    prices: [{ cat: 'std', month: 10, amount: 8000 }, { cat: 'dup', month: 10, amount: 9500 }, { cat: 'std', month: 9, amount: null }],
  }, adm);
  assert.equal(r.status, 200);
  const st = await state(adm);
  assert.equal(st.fx, 100);
  assert.equal(st.cats.dup.extra, 3500);
  assert.equal(st.prices.std.m[10], 8000);
  assert.equal(st.prices.dup.m[10], 9500);
  assert.equal(st.prices.std.m[9], undefined, 'a null price removes the month price');
});

test('Save button is all-or-nothing: one invalid value saves nothing', async () => {
  const adm = await loginAs('admin@lege.al');
  const before = await state(adm);
  const r = await call('PUT', '/pricing', {
    fx: 120,
    prices: [{ cat: 'std', month: 5, amount: 1234 }, { cat: 'dup', month: 5, amount: -5 }],
  }, adm);
  assert.equal(r.status, 400);
  const bad2 = await call('PUT', '/pricing', { fx: 130, categories: { dup: { inc: 99 } } }, adm);
  assert.equal(bad2.status, 400);
  const after = await state(adm);
  assert.equal(after.fx, before.fx, 'the exchange rate was not changed');
  assert.equal(after.prices.std.m[5], undefined, 'the valid price before the invalid one was rolled back');
});

/* ---------------- email notifications ---------------- */

test('every new reservation emails the manager and says who booked it', async () => {
  const rec = await loginAs('recepsion@lege.al');
  await flushMail();
  outbox.length = 0;
  const r = await call('POST', '/reservations', { guestName: 'Email Guest', phone: '+355 69 111 2222', roomId: '203', arr: day(40), dep: day(43), adults: 4, source: 'Phone', deposit: 5000, notes: 'Baby cot' }, rec);
  assert.equal(r.status, 200);
  await flushMail();
  assert.equal(outbox.length, 1, 'only the manager is notified (no guest email was given)');
  const m = outbox[0];
  assert.equal(m.to, 'admin@lege.al');
  assert.equal(m.from, 'Lege Hotel <hotel@lege.al>');
  assert.match(m.subject, /^New reservation: Email Guest, room 203/);
  assert.match(m.text, /Booked by: Recepsion \(Receptionist\)/);
  assert.match(m.text, /Deposit paid: 5,000 lek/);
  assert.match(m.text, /Baby cot/);
  assert.match(m.html, /<table/);
  assert.equal(m.raw.subject, m.subject);
  const log = db.prepare("SELECT status, recipient FROM email_log WHERE kind='reservation' ORDER BY id DESC LIMIT 1").get();
  assert.deepEqual(log, { status: 'sent', recipient: 'admin@lege.al' });
});

test('when the manager makes the reservation, the manager is notified as well', async () => {
  const adm = await loginAs('admin@lege.al');
  await flushMail(); outbox.length = 0;
  await call('POST', '/reservations', { guestName: 'By Manager', roomId: '204', arr: day(40), dep: day(41), adults: 2 }, adm);
  await flushMail();
  assert.equal(outbox.length, 1);
  assert.match(outbox[0].text, /Booked by: Admin \(Manager\)/);
});

test('NOTIFY_EMAILS overrides the recipients', async () => {
  const rec = await loginAs('recepsion@lege.al');
  const old = config.mail.notify;
  config.mail.notify = ['owner@lege.al', 'desk@lege.al'];
  try {
    await flushMail(); outbox.length = 0;
    await call('POST', '/reservations', { guestName: 'Two Recipients', roomId: '205', arr: day(40), dep: day(41), adults: 2 }, rec);
    await flushMail();
    assert.deepEqual(outbox.map((m) => m.to).sort(), ['desk@lege.al', 'owner@lege.al']);
  } finally { config.mail.notify = old; }
});

test('guest confirmation is sent only when an email is given and the box is ticked', async () => {
  const rec = await loginAs('recepsion@lege.al');
  await flushMail(); outbox.length = 0;
  await call('POST', '/reservations', { guestName: 'Yes Please', email: 'yes@example.com', notifyGuest: true, roomId: '206', arr: day(40), dep: day(42), adults: 2, deposit: 2000 }, rec);
  await call('POST', '/reservations', { guestName: 'No Thanks', email: 'no@example.com', notifyGuest: false, roomId: '207', arr: day(40), dep: day(42), adults: 2 }, rec);
  await flushMail();
  const toGuest = outbox.filter((m) => m.to === 'yes@example.com');
  assert.equal(toGuest.length, 1);
  assert.match(toGuest[0].subject, /Your reservation at Lege/);
  assert.match(toGuest[0].text, /Deposit received: 2,000 lek/);
  assert.ok(!/Booked by|Source/.test(toGuest[0].text), 'internal details are not sent to the guest');
  assert.equal(outbox.filter((m) => m.to === 'no@example.com').length, 0);
  assert.equal(db.prepare("SELECT email FROM guests WHERE name='No Thanks'").get().email, 'no@example.com', 'the address is still saved on the guest');
});

test('a failing mail server never blocks the reservation; the failure is logged for the manager', async () => {
  const rec = await loginAs('recepsion@lege.al');
  const adm = await loginAs('admin@lege.al');
  failMail = true;
  try {
    const r = await call('POST', '/reservations', { guestName: 'Mail Down', roomId: '208', arr: day(40), dep: day(41), adults: 2 }, rec);
    assert.equal(r.status, 200);
    await flushMail();
  } finally { failMail = false; }
  const n = await call('GET', '/notifications', null, adm);
  assert.equal(n.status, 200);
  assert.equal(n.data.enabled, true);
  assert.ok(n.data.recipients.includes('admin@lege.al'));
  const last = n.data.log[0];
  assert.equal(last.status, 'failed');
  assert.match(last.error, /SMTP connection refused/);
  assert.equal((await call('GET', '/notifications', null, rec)).status, 403);
});

test('test email button sends to the manager; without SMTP notifications are recorded as skipped', async () => {
  const adm = await loginAs('admin@lege.al');
  await flushMail(); outbox.length = 0;
  const t = await call('POST', '/notifications/test', null, adm);
  assert.equal(t.status, 200);
  assert.equal(t.data.status, 'sent');
  assert.equal(outbox[0].to, 'admin@lege.al');

  const off = createNotifier({ db, mailer: createMailer({}), config });
  outbox.length = 0;
  await off.reservationCreated(db.prepare('SELECT id FROM reservations LIMIT 1').get().id, { name: 'X', role: 'manager' });
  assert.equal(outbox.length, 0);
  assert.equal(db.prepare('SELECT status FROM email_log ORDER BY id DESC LIMIT 1').get().status, 'skipped');
});

/* ---------------- bar and restaurant ---------------- */

async function checkedInGuest(c, name, room, adults = 2) {
  const { data } = await call('POST', '/reservations', { guestName: name, roomId: room, arr: day(-1), dep: day(2), adults }, c);
  assert.equal((await call('POST', `/reservations/${data.id}/checkin`, null, c)).status, 200);
  return data.id;
}

test('bar order charged to the room is added to the bill; payments cover stay + charges', async () => {
  const c = await loginAs('recepsion@lege.al');
  const id = await checkedInGuest(c, 'Room Charge', '108');       // standard: 3 nights × 7,500 = 22,500
  const o = await call('POST', '/orders', {
    outlet: 'bar', destination: 'room', reservationId: id,
    items: [{ id: 'bar-espresso', qty: 2, price: 1 }, { id: 'bar-spritz', qty: 1 }],   // "price: 1" from the browser must be ignored
  }, c);
  assert.equal(o.status, 200);
  assert.equal(o.data.total, 2 * 150 + 700, 'the server uses the menu prices');
  const st = await state(c);
  const res = st.res.find((r) => r.id === id);
  assert.equal(res.chargesTotal, 1000);
  assert.equal(res.charges.length, 1);
  assert.deepEqual(res.charges[0].items.map((i) => [i.name, i.qty, i.price]), [['Espresso', 2, 150], ['Aperol Spritz', 1, 700]]);
  assert.equal((await call('POST', `/reservations/${id}/payments`, { amount: 23500, method: 'card' }, c)).status, 200, '22,500 stay + 1,000 charges');
  assert.equal((await call('POST', `/reservations/${id}/payments`, { amount: 1, method: 'cash' }, c)).status, 409);
});

test('restaurant order: only checked-in guests can charge a room; wrong-outlet, inactive and empty orders are refused', async () => {
  const c = await loginAs('recepsion@lege.al');
  const { data } = await call('POST', '/reservations', { guestName: 'Not Yet', roomId: '109', arr: day(5), dep: day(6), adults: 2 }, c);
  const notIn = await call('POST', '/orders', { outlet: 'restaurant', destination: 'room', reservationId: data.id, items: [{ id: 'rest-burger', qty: 1 }] }, c);
  assert.equal(notIn.status, 409);
  const id = await checkedInGuest(c, 'Diner', '110');
  const wrongOutlet = await call('POST', '/orders', { outlet: 'restaurant', destination: 'room', reservationId: id, items: [{ id: 'bar-cola', qty: 1 }] }, c);
  assert.equal(wrongOutlet.status, 400);
  assert.equal((await call('POST', '/orders', { outlet: 'restaurant', destination: 'room', reservationId: id, items: [] }, c)).status, 400);
  assert.equal((await call('POST', '/orders', { outlet: 'restaurant', destination: 'room', reservationId: id, items: [{ id: 'rest-burger', qty: 0 }] }, c)).status, 400);
  assert.equal((await call('POST', '/orders', { outlet: 'restaurant', destination: 'room', reservationId: id, items: [{ id: 'nope', qty: 1 }] }, c)).status, 400);
  const ok = await call('POST', '/orders', { outlet: 'restaurant', destination: 'room', reservationId: id, items: [{ id: 'rest-seabass', qty: 2 }, { id: 'rest-baklava', qty: 2 }] }, c);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.total, 2 * 1600 + 2 * 400);
});

test('pay-now orders need cash or card; the day report separates room charges, cash and card', async () => {
  const c = await loginAs('recepsion@lege.al');
  assert.equal((await call('POST', '/orders', { outlet: 'bar', destination: 'paid', items: [{ id: 'bar-cola', qty: 1 }] }, c)).status, 400, 'method missing');
  assert.equal((await call('POST', '/orders', { outlet: 'bar', destination: 'paid', method: 'cash', label: 'Terrace 2', items: [{ id: 'bar-cola', qty: 2 }] }, c)).status, 200);
  assert.equal((await call('POST', '/orders', { outlet: 'bar', destination: 'paid', method: 'card', items: [{ id: 'bar-beer-draft', qty: 1 }] }, c)).status, 200);
  const day1 = await call('GET', `/orders?date=${today()}&outlet=bar`, null, c);
  assert.equal(day1.status, 200);
  assert.ok(day1.data.totals.cash >= 400 && day1.data.totals.card >= 300 && day1.data.totals.room >= 1000);
  assert.ok(day1.data.orders.every((o) => o.outlet === 'bar'));
  assert.ok(day1.data.orders.some((o) => o.label === 'Terrace 2' && o.staff === 'Recepsion'));
  assert.equal((await call('GET', '/orders?date=2026-13-40', null, c)).status, 400);
  assert.equal((await call('GET', `/orders?date=${today()}&outlet=spa`, null, c)).status, 400);
});

test('only the manager can void an order; voiding removes the room charge', async () => {
  const rec = await loginAs('recepsion@lege.al');
  const adm = await loginAs('admin@lege.al');
  const id = await checkedInGuest(rec, 'Void Guest', '104');
  const o = (await call('POST', '/orders', { outlet: 'bar', destination: 'room', reservationId: id, items: [{ id: 'bar-mojito', qty: 2 }] }, rec)).data;
  assert.equal((await call('POST', `/orders/${o.id}/void`, null, rec)).status, 403);
  assert.equal((await call('POST', `/orders/${o.id}/void`, null, adm)).status, 200);
  assert.equal((await call('POST', `/orders/${o.id}/void`, null, adm)).status, 409, 'already voided');
  const res = (await state(rec)).res.find((r) => r.id === id);
  assert.equal(res.chargesTotal, 0);
  // after check-out a room charge can no longer be voided
  const o2 = (await call('POST', '/orders', { outlet: 'bar', destination: 'room', reservationId: id, items: [{ id: 'bar-mojito', qty: 1 }] }, rec)).data;
  await call('POST', `/reservations/${id}/payments`, { amount: 22500 + 700, method: 'cash' }, rec);
  const out = await call('POST', `/reservations/${id}/checkout`, null, rec);
  assert.equal(out.status, 200);
  assert.equal(out.data.balance, 0);
  assert.equal((await call('POST', `/orders/${o2.id}/void`, null, adm)).status, 409);
});

test('check-out reports the unpaid balance including room charges', async () => {
  const c = await loginAs('recepsion@lege.al');
  const id = await checkedInGuest(c, 'Owes Money', '102');
  await call('POST', '/orders', { outlet: 'restaurant', destination: 'room', reservationId: id, items: [{ id: 'rest-burger', qty: 2 }] }, c);
  const out = await call('POST', `/reservations/${id}/checkout`, null, c);
  assert.equal(out.data.shortened, true);
  assert.equal(out.data.balance, 7500 + 1800, 'nothing was paid: 1 night actually stayed (7,500) + 1,800 of restaurant charges');
});

test('menu: the manager adds, edits, hides and deletes items; the receptionist cannot', async () => {
  const rec = await loginAs('recepsion@lege.al');
  const adm = await loginAs('admin@lege.al');
  const item = { outlet: 'bar', section: 'Coffee', name: 'Turkish coffee', price: 200 };
  assert.equal((await call('POST', '/menu', item, rec)).status, 403);
  const created = await call('POST', '/menu', item, adm);
  assert.equal(created.status, 200);
  const id = created.data.id;
  assert.equal((await call('POST', '/menu', { ...item, outlet: 'spa' }, adm)).status, 400);
  assert.equal((await call('POST', '/menu', { ...item, price: -1 }, adm)).status, 400);
  assert.equal((await call('PATCH', `/menu/${id}`, { price: 220 }, rec)).status, 403);
  assert.equal((await call('PATCH', `/menu/${id}`, { price: 220 }, adm)).status, 200);
  assert.equal((await state(rec)).menu.find((m) => m.id === id).price, 220);
  const g = await checkedInGuest(rec, 'Coffee Guest', '103');
  assert.equal((await call('PATCH', `/menu/${id}`, { active: false }, adm)).status, 200);
  assert.equal((await call('POST', '/orders', { outlet: 'bar', destination: 'room', reservationId: g, items: [{ id, qty: 1 }] }, rec)).status, 409, 'hidden items cannot be ordered');
  assert.equal((await call('DELETE', `/menu/${id}`, null, rec)).status, 403);
  assert.equal((await call('DELETE', `/menu/${id}`, null, adm)).status, 200);
  assert.equal((await call('DELETE', `/menu/${id}`, null, adm)).status, 404);
});

/* ---------------- beach umbrellas ---------------- */

test('beach: 39 umbrellas, all free at the start', async () => {
  const c = await loginAs('recepsion@lege.al');
  const r = await call('GET', `/beach?date=${day(60)}`, null, c);
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 39);
  assert.equal(r.data.spots.length, 39);
  assert.equal(r.data.free, 39);
  assert.equal(r.data.taken, 0);
  assert.equal(r.data.spots[0].spot, 1);
  assert.equal(r.data.spots[38].spot, 39);
  assert.equal((await call('GET', '/beach?date=nonsense', null, c)).status, 400);
});

test('beach: assign an umbrella to a walk-in by name, and to a hotel guest by reservation (room number shown)', async () => {
  const c = await loginAs('recepsion@lege.al');
  const d = day(50);
  const walk = await call('POST', '/beach/bookings', { spot: 5, from: d, guestName: 'Anna Smith' }, c);
  assert.equal(walk.status, 200);
  const resId = (await call('POST', '/reservations', { guestName: 'Beach Guest', roomId: '209', arr: day(50), dep: day(53), adults: 2 }, c)).data.id;
  const linked = await call('POST', '/beach/bookings', { spot: 6, from: day(50), to: day(52), reservationId: resId }, c);
  assert.equal(linked.status, 200);

  let r = (await call('GET', `/beach?date=${d}`, null, c)).data;
  assert.equal(r.taken, 2);
  assert.equal(r.free, 37);
  const s5 = r.spots[4].booking, s6 = r.spots[5].booking;
  assert.equal(s5.guestName, 'Anna Smith');
  assert.equal(s5.roomId, null);
  assert.equal(s6.guestName, 'Beach Guest');
  assert.equal(s6.roomId, '209');
  assert.equal(s6.createdBy, 'Recepsion');
  r = (await call('GET', `/beach?date=${day(53)}`, null, c)).data;
  assert.equal(r.spots[5].booking, null, 'the range ended on day 52');
  assert.equal(r.spots[4].booking, null, 'the walk-in booked a single day');
});

test('beach: double booking, bad dates, bad umbrella numbers and stays outside the reservation are refused', async () => {
  const c = await loginAs('recepsion@lege.al');
  const d = day(50);
  const clash = await call('POST', '/beach/bookings', { spot: 5, from: d, to: day(52), guestName: 'Someone Else' }, c);
  assert.equal(clash.status, 409);
  assert.match(clash.data.error, /Anna Smith/);
  assert.equal((await call('POST', '/beach/bookings', { spot: 5, from: day(51), to: day(52), guestName: 'Next Day' }, c)).status, 200, 'other days are free');
  assert.equal((await call('POST', '/beach/bookings', { spot: 0, from: d, guestName: 'X Y' }, c)).status, 400);
  assert.equal((await call('POST', '/beach/bookings', { spot: 40, from: d, guestName: 'X Y' }, c)).status, 400);
  assert.equal((await call('POST', '/beach/bookings', { spot: 7, from: d, to: day(49), guestName: 'X Y' }, c)).status, 400);
  assert.equal((await call('POST', '/beach/bookings', { spot: 7, from: d, to: day(200), guestName: 'X Y' }, c)).status, 400, 'more than 60 days');
  assert.equal((await call('POST', '/beach/bookings', { spot: 7, from: d }, c)).status, 400, 'a name or a reservation is required');
  const resId = db.prepare("SELECT r.id FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE g.name='Beach Guest'").get().id;
  assert.equal((await call('POST', '/beach/bookings', { spot: 8, from: day(50), to: day(60), reservationId: resId }, c)).status, 409, 'beyond the departure day');
  assert.equal((await call('POST', '/beach/bookings', { spot: 8, from: day(49), reservationId: resId }, c)).status, 409, 'before the arrival day');
  const cancelled = (await call('POST', '/reservations', { guestName: 'Cancelled Beach', roomId: '210', arr: day(50), dep: day(51), adults: 2 }, c)).data.id;
  await call('POST', `/reservations/${cancelled}/cancel`, null, c);
  assert.equal((await call('POST', '/beach/bookings', { spot: 9, from: day(50), reservationId: cancelled }, c)).status, 409);
});

test('beach: releasing an umbrella makes it free again; the manager can change the number of umbrellas', async () => {
  const rec = await loginAs('recepsion@lege.al');
  const adm = await loginAs('admin@lege.al');
  const d = day(50);
  const b = (await call('GET', `/beach?date=${d}`, null, rec)).data.spots[4].booking;
  assert.equal((await call('DELETE', `/beach/bookings/${b.id}`, null, rec)).status, 200);
  assert.equal((await call('DELETE', `/beach/bookings/${b.id}`, null, rec)).status, 404);
  assert.equal((await call('GET', `/beach?date=${d}`, null, rec)).data.spots[4].booking, null);

  assert.equal((await call('PUT', '/settings', { beachUmbrellas: 45 }, rec)).status, 403);
  assert.equal((await call('PUT', '/settings', { beachUmbrellas: 45 }, adm)).status, 200);
  assert.equal((await call('GET', `/beach?date=${d}`, null, rec)).data.total, 45);
  assert.equal((await call('PUT', '/settings', { beachUmbrellas: 0 }, adm)).status, 400);
  await call('POST', '/beach/bookings', { spot: 44, from: d, guestName: 'Far Away' }, rec);
  const shrink = await call('PUT', '/settings', { beachUmbrellas: 39 }, adm);
  assert.equal(shrink.status, 409, 'umbrella 44 still has a booking');
  const far = (await call('GET', `/beach?date=${d}`, null, rec)).data.spots[43].booking;
  await call('DELETE', `/beach/bookings/${far.id}`, null, rec);
  assert.equal((await call('PUT', '/settings', { beachUmbrellas: 39 }, adm)).status, 200);
  assert.equal((await state(adm)).beachUmbrellas, 39);
});

/* ---------------- guests, requests, security ---------------- */

test('requests, preferences and guest notes', async () => {
  const c = await loginAs('recepsion@lege.al');
  const st = await state(c);
  const g = st.guests[0];
  assert.equal((await call('PATCH', `/guests/${g.id}`, { prefs: ['High floor'], notes: 'VIP' }, c)).status, 200);
  assert.equal((await call('POST', '/requests', { guestId: g.id, type: 'Transport', note: 'Taxi at 07:00' }, c)).status, 200);
  const after = await state(c);
  assert.deepEqual(after.guests.find((x) => x.id === g.id).prefs, ['High floor']);
  const q = after.reqs[0];
  assert.equal((await call('POST', `/requests/${q.id}/done`, null, c)).status, 200);
});

test('requests from a foreign origin are refused', async () => {
  const c = await loginAs('recepsion@lege.al');
  const res = await fetch(base + '/api/rooms/101/dirty', { method: 'POST', headers: { Cookie: c, Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

test('changing the password needs the current password and the minimum length', async () => {
  const c = await loginAs('recepsion@lege.al');
  assert.equal((await call('POST', '/auth/password', { current: 'wrong', next: 'a-new-password-1234' }, c)).status, 400);
  assert.equal((await call('POST', '/auth/password', { current: PASSWORD, next: 'short' }, c)).status, 400);
});

/* ---------------- separate frontend: token, CORS, users ---------------- */

test('sign-in returns a token and the user with a role; the token works without a cookie', async () => {
  const r = await call('POST', '/auth/login', { email: 'recepsion@lege.al', password: PASSWORD });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'receptionist');
  assert.ok(r.data.token && r.data.token.split('.').length === 3);
  const me = await callBearer('GET', '/auth/me', null, r.data.token);
  assert.equal(me.status, 200);
  assert.equal(me.data.email, 'recepsion@lege.al');
  assert.equal((await callBearer('GET', '/state', null, 'invalid.token.here')).status, 401);
});

test('CORS: the allowed origin gets the headers, a foreign one does not; preflight returns 204', async () => {
  const pre = await fetch(base + '/api/state', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
  const bad = await fetch(base + '/api/state', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('an allowed frontend can make changing requests with a token; a foreign origin is refused', async () => {
  const token = await tokenFor('recepsion@lege.al');
  const ok = await callBearer('POST', '/rooms/109/dirty', null, token, { Origin: 'http://localhost:5173' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const no = await callBearer('POST', '/rooms/109/clean', null, token, { Origin: 'https://evil.example' });
  assert.equal(no.status, 403);
});

test('the manager creates a receptionist; a receptionist cannot manage users', async () => {
  const mgr = await tokenFor('admin@lege.al');
  const rec = await tokenFor('recepsion@lege.al');
  const mk = { email: 'Nova@Lege.al', name: 'Nova', password: 'a-new-password-1234', role: 'receptionist' };
  assert.equal((await callBearer('POST', '/users', mk, rec)).status, 403);
  assert.equal((await callBearer('GET', '/users', null, rec)).status, 403);
  const created = await callBearer('POST', '/users', mk, mgr);
  assert.equal(created.status, 200);
  assert.equal((await callBearer('POST', '/users', mk, mgr)).status, 409, 'duplicate email');
  assert.equal((await callBearer('POST', '/users', { ...mk, email: 'x@lege.al', password: 'short' }, mgr)).status, 400);
  assert.equal((await callBearer('POST', '/users', { ...mk, email: 'y@lege.al', role: 'admin' }, mgr)).status, 400);
  assert.equal((await callBearer('POST', '/users', { ...mk, email: 'not-an-email' }, mgr)).status, 400);
  const list = await callBearer('GET', '/users', null, mgr);
  const nova = list.data.find((u) => u.email === 'nova@lege.al');
  assert.equal(nova.role, 'receptionist');
  assert.ok(!('password_hash' in nova));
  // the new account signs in with its email (case-insensitive) and as a receptionist
  assert.equal((await call('POST', '/auth/login', { email: 'NOVA@lege.al', password: 'a-new-password-1234', role: 'receptionist' })).status, 200);
  assert.equal((await call('POST', '/auth/login', { email: 'NOVA@lege.al', password: 'a-new-password-1234', role: 'manager' })).status, 403);
});

test('a password reset closes the old token; you cannot delete yourself or the last manager', async () => {
  const mgr = await tokenFor('admin@lege.al');
  const users = (await callBearer('GET', '/users', null, mgr)).data;
  const nova = users.find((u) => u.email === 'nova@lege.al');
  const oldTok = await tokenFor('nova@lege.al', 'a-new-password-1234');
  assert.equal((await callBearer('GET', '/state', null, oldTok)).status, 200);
  assert.equal((await callBearer('POST', `/users/${nova.id}/password`, { password: 'another-password-56789' }, mgr)).status, 200);
  assert.equal((await callBearer('GET', '/state', null, oldTok)).status, 401, 'the old token is no longer valid');
  assert.equal((await call('POST', '/auth/login', { email: 'nova@lege.al', password: 'a-new-password-1234' })).status, 401);
  assert.ok(await tokenFor('nova@lege.al', 'another-password-56789'));

  const self = users.find((u) => u.email === 'admin@lege.al');
  assert.equal((await callBearer('DELETE', `/users/${self.id}`, null, mgr)).status, 409, 'cannot delete yourself');
  assert.equal((await callBearer('PATCH', `/users/${self.id}`, { role: 'receptionist' }, mgr)).status, 409, 'the last manager cannot be demoted');
  assert.equal((await callBearer('DELETE', `/users/${nova.id}`, null, mgr)).status, 200);
  assert.equal((await callBearer('GET', '/state', null, await tokenFor('recepsion@lege.al'))).status, 200);
});

/* ---------------- migrations ---------------- */

test('migration: old roles become manager and receptionist; Albanian data becomes English; menu and umbrellas are added', () => {
  const Database = require('better-sqlite3');
  const raw = new Database(':memory:');
  raw.exec(dbLib.MIGRATIONS[0]);
  raw.pragma('user_version = 1');
  const ins = raw.prepare("INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,'2026-01-01')");
  ins.run('1', 'a@x.al', 'A', 'h', 'admin');
  ins.run('2', 'b@x.al', 'B', 'h', 'reception');
  raw.prepare("INSERT INTO categories (key,name,cap,inc,extra) VALUES ('dup','Duplex familjar',10,2,2500)").run();
  raw.prepare("INSERT INTO rooms (id,floor,cat,dirty) VALUES ('201',2,'dup',0)").run();
  raw.prepare("INSERT INTO guests (id,name,created_at) VALUES ('g','G','2026-01-01')").run();
  raw.prepare("INSERT INTO reservations (id,guest_id,room_id,arr,dep,status,source,adults,created_at) VALUES ('r','g','201','2026-09-01','2026-09-02','confirmed','Agjenci',2,'2026-01-01')").run();
  raw.prepare("INSERT INTO requests (id,guest_id,type,note,day,created_at) VALUES ('q','g','Shërbim dhome','x','2026-09-01','2026-09-01')").run();
  dbLib.migrate(raw);
  assert.deepEqual(raw.prepare('SELECT email, role FROM users ORDER BY email').all(),
    [{ email: 'a@x.al', role: 'manager' }, { email: 'b@x.al', role: 'receptionist' }]);
  assert.equal(raw.prepare("SELECT name FROM categories WHERE key='dup'").get().name, 'Family Duplex');
  assert.equal(raw.prepare("SELECT source FROM reservations WHERE id='r'").get().source, 'Agency');
  assert.equal(raw.prepare("SELECT type FROM requests WHERE id='q'").get().type, 'Room service');
  assert.ok(raw.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n >= 20);
  assert.equal(raw.prepare("SELECT value FROM settings WHERE key='beach_umbrellas'").get().value, '39');
  assert.equal(raw.pragma('user_version', { simple: true }), dbLib.MIGRATIONS.length);
  raw.close();
});
