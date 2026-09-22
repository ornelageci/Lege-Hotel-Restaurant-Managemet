/**
 * Email notifications.
 *  - Every new reservation is announced by email to the hotel staff (NOTIFY_EMAILS, or all managers if not set),
 *    with who created it.
 *  - Optionally the guest gets a confirmation when an email address is entered and the box is ticked.
 * Sending never blocks or breaks the reservation: failures are recorded in the email log (visible to the manager).
 */
const Pricing = require('../public/pricing.js');
const svc = require('./service');
const { nowIso } = require('./util');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('en-US')} lek`;
const fmtDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const ROLE_LABEL = { manager: 'Manager', receptionist: 'Receptionist' };

function layout(hotel, heading, rows, footer) {
  const tr = rows.map(([k, v]) => `<tr><td style="padding:6px 16px 6px 0;color:#617069;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`).join('');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;color:#13231E;max-width:560px">
<h2 style="font-weight:400;margin:0 0 4px">${esc(heading)}</h2>
<p style="margin:0 0 16px;color:#617069">${esc(hotel)}</p>
<table style="border-collapse:collapse;font-size:15px">${tr}</table>
${footer ? `<p style="margin-top:20px;color:#617069;font-size:13px">${esc(footer)}</p>` : ''}</div>`;
}
const plain = (heading, rows, footer) => `${heading}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}${footer ? `\n\n${footer}` : ''}\n`;

function createNotifier({ db, mailer, config }) {
  const pending = new Set();
  const track = (p) => { pending.add(p); p.finally(() => pending.delete(p)); return p; };

  const hotelName = () => (db.prepare("SELECT value FROM settings WHERE key='hotel_name'").get() || {}).value || config.hotelName;

  function record(kind, recipient, subject, status, error) {
    db.prepare('INSERT INTO email_log (at,kind,recipient,subject,status,error) VALUES (?,?,?,?,?,?)')
      .run(nowIso(), kind, recipient, subject, status, error ? String(error).slice(0, 300) : null);
  }

  /** Sends one email and records the outcome. Never throws. */
  async function deliver(kind, to, msg) {
    const subject = oneLine(msg.subject);
    if (!mailer.enabled) { record(kind, to, subject, 'skipped', 'Email is not configured (SMTP_HOST is missing).'); return 'skipped'; }
    try {
      await mailer.send({ to, subject, text: msg.text, html: msg.html });
      record(kind, to, subject, 'sent');
      return 'sent';
    } catch (e) {
      record(kind, to, subject, 'failed', e && e.message);
      console.error(`Email to ${to} failed: ${e && e.message}`);
      return 'failed';
    }
  }

  /** Staff recipients: NOTIFY_EMAILS if set, otherwise every manager. */
  function staffRecipients() {
    if (config.mail.notify.length) return config.mail.notify;
    return db.prepare("SELECT email FROM users WHERE role='manager' ORDER BY name").all().map((u) => u.email);
  }

  function reservationData(id) {
    const r = db.prepare(`SELECT r.*, g.name AS guest_name, g.phone, g.email AS guest_email, c.name AS cat_name
                          FROM reservations r JOIN guests g ON g.id = r.guest_id
                          JOIN rooms rm ON rm.id = r.room_id JOIN categories c ON c.key = rm.cat WHERE r.id = ?`).get(id);
    if (!r) return null;
    const total = svc.reservationTotal(db, r);
    return { ...r, total, paid: svc.paidOf(db, id), nights: Pricing.diffDays(r.arr, r.dep) };
  }

  function staffMessage(r, actor, hotel) {
    const rows = [
      ['Guest', r.guest_name],
      ['Room', `${r.room_id} (${r.cat_name})`],
      ['Arrival', fmtDate(r.arr)],
      ['Departure', fmtDate(r.dep)],
      ['Nights / people', `${r.nights} / ${r.adults}`],
      ['Total', money(r.total)],
      ['Deposit paid', money(r.paid)],
      ['Still to pay', money(Math.max(0, r.total - r.paid))],
      ['Source', r.source],
    ];
    if (r.phone) rows.push(['Phone', r.phone]);
    if (r.guest_email) rows.push(['Email', r.guest_email]);
    if (r.notes) rows.push(['Special requests', r.notes]);
    rows.push(['Booked by', `${actor.name} (${ROLE_LABEL[actor.role] || actor.role})`]);
    rows.push(['Reference', r.id.slice(0, 8).toUpperCase()]);
    const heading = 'New reservation';
    return {
      subject: `New reservation: ${r.guest_name}, room ${r.room_id}, ${fmtDate(r.arr)} to ${fmtDate(r.dep)}`,
      text: plain(heading, rows),
      html: layout(hotel, heading, rows),
    };
  }

  function guestMessage(r, hotel) {
    const rows = [
      ['Guest', r.guest_name],
      ['Room type', r.cat_name],
      ['Arrival', fmtDate(r.arr)],
      ['Departure', fmtDate(r.dep)],
      ['Nights / people', `${r.nights} / ${r.adults}`],
      ['Total', money(r.total)],
    ];
    if (r.paid > 0) rows.push(['Deposit received', money(r.paid)]);
    rows.push(['Reference', r.id.slice(0, 8).toUpperCase()]);
    const heading = 'Your reservation is confirmed';
    const footer = `Thank you for choosing ${hotel}. We look forward to welcoming you.`;
    return { subject: `Your reservation at ${hotel}`, text: plain(heading, rows, footer), html: layout(hotel, heading, rows, footer) };
  }

  /** Called after a reservation is saved. Returns a promise that resolves when all emails were attempted. */
  function reservationCreated(reservationId, actor, { notifyGuest = false } = {}) {
    return track((async () => {
      const r = reservationData(reservationId);
      if (!r) return;
      const hotel = hotelName();
      const staff = staffMessage(r, actor, hotel);
      const to = staffRecipients();
      if (!to.length) record('reservation', '(nobody)', oneLine(staff.subject), 'skipped', 'No recipients: set NOTIFY_EMAILS or create a manager account.');
      for (const addr of to) await deliver('reservation', addr, staff);
      if (notifyGuest && r.guest_email) await deliver('guest-confirmation', r.guest_email, guestMessage(r, hotel));
    })());
  }

  /** "Send test email" button in the manager's screen. */
  function sendTest(to) {
    const hotel = hotelName();
    const rows = [['Status', 'Email notifications are working'], ['Sent', new Date().toISOString()]];
    return track(deliver('test', to, { subject: `Test email from ${hotel}`, text: plain('Test email', rows), html: layout(hotel, 'Test email', rows) }));
  }

  const status = () => ({
    enabled: mailer.enabled,
    from: mailer.enabled ? mailer.from : '',
    recipients: staffRecipients(),
    log: db.prepare('SELECT at, kind, recipient, subject, status, error FROM email_log ORDER BY id DESC LIMIT 20').all(),
  });

  return { reservationCreated, sendTest, status, flush: () => Promise.allSettled([...pending]) };
}

module.exports = { createNotifier };
