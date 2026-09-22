const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const dbLib = require('./db');
const auth = require('./auth');
const { createRouter } = require('./routes');
const { cors } = require('./cors');
const { HttpError } = require('./errors');
const { createMailer } = require('./mailer');
const { createNotifier } = require('./notifications');

function createApp(db, opts = {}) {
  const app = express();
  const mailer = opts.mailer || createMailer(config.mail);
  const notifier = createNotifier({ db, mailer, config });
  app.locals.notifier = notifier;
  app.locals.mailer = mailer;
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ['https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    hsts: config.cookieSecure,
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(auth.authenticate(db));

  app.use('/api', cors(config.corsOrigins), createRouter(db, { mailer, notifier }));
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
  }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  });
  return app;
}

/**
 * Creates the first accounts from the environment when there are no users yet:
 * the manager (ADMIN_EMAIL / ADMIN_PASSWORD) and, optionally, a receptionist (RECEPTIONIST_EMAIL / RECEPTIONIST_PASSWORD).
 */
function bootstrapAdmin(db) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (n > 0) return;
  if (config.adminEmail && config.adminPassword) {
    auth.createUser(db, { email: config.adminEmail, name: 'Manager', password: config.adminPassword, role: 'manager' });
    console.log(`Manager ${config.adminEmail} created. Remove ADMIN_PASSWORD from .env after you sign in.`);
    if (config.receptionistEmail && config.receptionistPassword) {
      auth.createUser(db, { email: config.receptionistEmail, name: 'Receptionist', password: config.receptionistPassword, role: 'receptionist' });
      console.log(`Receptionist ${config.receptionistEmail} created. Remove RECEPTIONIST_PASSWORD from .env after you sign in.`);
    }
  } else {
    console.warn('No users exist. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env, or run: npm run create-user');
  }
}

if (require.main === module) {
  const db = dbLib.open(config.dbPath, config.hotelName);
  bootstrapAdmin(db);
  const app = createApp(db);
  const server = app.listen(config.port, () => console.log(`Lege is listening on http://localhost:${config.port}`));
  const stop = () => { server.close(() => { db.close(); process.exit(0); }); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { createApp, bootstrapAdmin };
