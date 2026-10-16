const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const auth = require('./auth');
const svc = require('./service');
const users = require('./users');
const beach = require('./beach');
const pos = require('./pos');
const fx = require('./fx');
const { HttpError } = require('./errors');

function createRouter(db, { mailer, notifier }) {
  const r = express.Router();

  // CSRF protection: requests that change data must come from the same origin and be sent as JSON.
  r.use((req, _res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin) {
        let ok = false;
        try { ok = new URL(origin).host === req.get('host') || config.corsOrigins.includes(origin); } catch (_e) { ok = false; }
        if (!ok) return next(new HttpError(403, 'Request refused (origin not allowed).'));
      }
      const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'];
      if (hasBody && !req.is('application/json')) return next(new HttpError(415, 'The content must be JSON.'));
    }
    next();
  });

  const h = (fn) => (req, res, next) => {
    try { res.json(fn(req, res) ?? { ok: true }); } catch (e) { next(e); }
  };
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: config.loginLimit, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
  });

  /* ---- authentication ---- */
  r.post('/auth/login', loginLimiter, h((req, res) => {
    const user = auth.login(db, req.body.email, req.body.password, req.body.role);
    const token = auth.issueToken(user);
    auth.setCookie(res, token);   // for the built-in interface
    // Separate frontends store the token and send it with every request: Authorization: Bearer <token>
    return { ok: true, token, expiresIn: 12 * 60 * 60, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  }));
  r.post('/auth/logout', h((_req, res) => { res.clearCookie(auth.COOKIE, { path: '/' }); }));
  r.get('/health', (_req, res) => res.json({ ok: true }));

  r.use(auth.requireAuth);

  r.get('/auth/me', h((req) => ({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role })));
  r.post('/auth/password', h((req) => { auth.changePassword(db, req.user.id, req.body.current, req.body.next); }));

  /* ---- state ---- */
  r.get('/state', h((req) => svc.getState(db, req.user, { tz: config.tz, mailEnabled: mailer.enabled })));

  /* ---- reservations ---- */
  r.post('/reservations', h((req) => {
    const id = svc.createReservation(db, req.user, req.body);
    // Email the staff (and optionally the guest). Runs in the background and never blocks or fails the reservation.
    notifier.reservationCreated(id, req.user, { notifyGuest: req.body.notifyGuest === true });
    return { id };
  }));
  r.patch('/reservations/:id', h((req) => { svc.updateReservation(db, req.user, req.params.id, req.body); }));
  for (const action of ['checkin', 'checkout', 'cancel', 'restore']) {
    r.post(`/reservations/:id/${action}`, h((req) => svc.setStatus(db, req.user, req.params.id, action, config)));
  }
  r.post('/reservations/:id/payments', h((req) => svc.addPayment(db, req.user, req.params.id, req.body)));

  /* ---- rooms ---- */
  r.post('/rooms/:id/clean', h((req) => { svc.setRoomDirty(db, req.user, req.params.id, false); }));
  r.post('/rooms/:id/dirty', h((req) => { svc.setRoomDirty(db, req.user, req.params.id, true); }));

  /* ---- guests and requests ---- */
  r.patch('/guests/:id', h((req) => { svc.updateGuest(db, req.user, req.params.id, req.body); }));
  r.post('/requests', h((req) => svc.createRequest(db, req.user, req.body)));
  r.post('/requests/:id/done', h((req) => { svc.completeRequest(db, req.user, req.params.id); }));
  r.post('/requests/:id/status', h((req) => { svc.setRequestStatus(db, req.user, req.params.id, req.body.status); }));

  /* ---- exchange rates (automatic; see server/fx.js) ---- */
  r.get('/fx', h(() => fx.getRates(db)));
  r.post('/fx/refresh', auth.requireManager, async (_req, res, next) => {
    try { res.json(await fx.refresh(db, { url: config.fxUrl })); } catch (e) { next(new HttpError(502, `Could not reach the exchange-rate service: ${e.message} The last saved rates stay in use.`)); }
  });

  /* ---- beach umbrellas ---- */
  r.get('/beach', h((req) => beach.day(db, req.query.date || svc.today(config.tz))));
  r.post('/beach/bookings', h((req) => ({ id: beach.create(db, req.user, req.body) })));
  r.delete('/beach/bookings/:id', h((req) => { beach.release(db, req.user, req.params.id); }));

  /* ---- bar and restaurant ---- */
  r.get('/orders', h((req) => pos.listOrders(db, { date: req.query.date || svc.today(config.tz), outlet: req.query.outlet })));
  r.post('/orders', h((req) => pos.createOrder(db, req.user, req.body, config.tz)));
  r.post('/orders/:id/void', auth.requireManager, h((req) => { pos.voidOrder(db, req.user, req.params.id); }));
  r.post('/menu', auth.requireManager, h((req) => pos.createMenuItem(db, req.user, req.body)));
  r.patch('/menu/:id', auth.requireManager, h((req) => { pos.updateMenuItem(db, req.user, req.params.id, req.body); }));
  r.delete('/menu/:id', auth.requireManager, h((req) => { pos.deleteMenuItem(db, req.user, req.params.id); }));

  /* ---- manager only ---- */
  r.put('/settings', auth.requireManager, h((req) => { svc.updateSettings(db, req.user, req.body); }));
  r.put('/categories/:key', auth.requireManager, h((req) => { svc.updateCategory(db, req.user, req.params.key, req.body); }));
  r.put('/prices', auth.requireManager, h((req) => { svc.setPrice(db, req.user, req.body); }));
  r.put('/pricing', auth.requireManager, h((req) => { svc.savePricing(db, req.user, req.body); }));   // the "Save" button: everything at once
  r.get('/activity', auth.requireManager, h(() => svc.recentActivity(db)));

  r.get('/notifications', auth.requireManager, h(() => notifier.status()));
  r.post('/notifications/test', auth.requireManager, async (req, res, next) => {
    try { res.json({ status: await notifier.sendTest(req.user.email) }); } catch (e) { next(e); }
  });

  r.get('/users', auth.requireManager, h(() => users.listUsers(db)));
  r.post('/users', auth.requireManager, h((req) => users.createUser(db, req.user, req.body)));
  r.patch('/users/:id', auth.requireManager, h((req) => { users.updateUser(db, req.user, req.params.id, req.body); }));
  r.post('/users/:id/password', auth.requireManager, h((req) => { users.resetPassword(db, req.user, req.params.id, req.body.password); }));
  r.delete('/users/:id', auth.requireManager, h((req) => { users.deleteUser(db, req.user, req.params.id); }));

  r.use((_req, _res, next) => next(new HttpError(404, 'Route not found.')));
  return r;
}
module.exports = { createRouter };
