/**
 * Email sending over SMTP (nodemailer). Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM in .env.
 * Without SMTP_HOST the mailer is disabled and notifications are only recorded in the email log as "skipped".
 * A ready-made transport can be passed in (used by the tests).
 */
const nodemailer = require('nodemailer');

function createMailer(cfg, transportOverride) {
  let transport = transportOverride || null;
  if (!transport && cfg.host) {
    transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  const from = cfg.from || 'no-reply@localhost';
  return {
    enabled: !!transport,
    from,
    async send({ to, subject, text, html }) {
      if (!transport) throw new Error('Email is not configured (SMTP_HOST is missing).');
      return transport.sendMail({ from, to, subject, text, html });
    },
  };
}

module.exports = { createMailer };
