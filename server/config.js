require('dotenv').config();
const path = require('path');

const env = process.env;
const prod = env.NODE_ENV === 'production';
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

const smtpPort = Number(env.SMTP_PORT) || 587;

const config = {
  prod,
  port: Number(env.PORT) || 3000,
  dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'lege.db'),
  jwtSecret: env.JWT_SECRET || (prod ? null : 'development-only-change-in-production'),
  tz: env.HOTEL_TZ || 'Europe/Tirane',
  hotelName: env.HOTEL_NAME || 'Lege',
  adminEmail: env.ADMIN_EMAIL || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  receptionistEmail: env.RECEPTIONIST_EMAIL || '',
  receptionistPassword: env.RECEPTIONIST_PASSWORD || '',
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : prod,
  trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : (prod ? 1 : 0),
  loginLimit: Number(env.LOGIN_RATE_LIMIT) || 20,
  // Origins of separate frontends allowed to call the API, e.g. https://panel.lege.al,http://localhost:5173
  corsOrigins: list(env.CORS_ORIGINS).map((s) => s.replace(/\/$/, '')),
  // Email. Without SMTP_HOST nothing is sent; every notification is recorded as "skipped".
  mail: {
    host: env.SMTP_HOST || '',
    port: smtpPort,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : smtpPort === 465,
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || env.SMTP_USER || '',
    // Who is notified of every new reservation. Empty = all managers.
    notify: list(env.NOTIFY_EMAILS),
  },
};
if (config.corsOrigins.includes('*')) {
  console.error('ERROR: CORS_ORIGINS does not allow "*". Set specific origins separated by commas.');
  process.exit(1);
}

if (prod && !config.jwtSecret) {
  console.error('ERROR: JWT_SECRET is missing. Set a long random value in the .env file.');
  process.exit(1);
}
if (prod && config.jwtSecret && config.jwtSecret.length < 32) {
  console.error('ERROR: JWT_SECRET must be at least 32 characters.');
  process.exit(1);
}
module.exports = config;
