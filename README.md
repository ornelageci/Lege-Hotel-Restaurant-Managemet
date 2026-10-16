# Lege · Hotel management system

A web app for the front desk of Hotel Lege: the reservations calendar, room plan, guest book with loyalty tiers, concierge requests, payments and prices by month and number of people — plus a bar & restaurant till, a beach umbrella tracker, and email notifications.

- **Backend:** Node.js, Express, SQLite (`better-sqlite3`)
- **Frontend:** plain HTML, CSS and JavaScript (no build step)
- **Security:** email + password sign-in (bcrypt), two roles (`manager`, `receptionist`) each checked against the role picked at login, session via `httpOnly` cookie or Bearer token, login rate-limiting, CSRF protection, CORS allow-list, `helmet` with a CSP
- **Tests:** 49 automated tests (`npm test`) covering prices, conflicts, capacity, payments, check-in/check-out, roles, tokens, CORS, the database migration, bar/restaurant orders, beach umbrellas and email notifications
- **API for a separate frontend:** see [`docs/API.md`](docs/API.md) and the ready-made client `docs/lege-client.mjs`

## What the app covers

- **Reservations & rooms** — a calendar view of every stay, a floor-by-floor room board, check-in/check-out, cleaning status.
- **Guests** — a guest book with a loyalty programme (Silver/Gold/Platinum), preferences and notes.
- **Prices** — per room category and month, with a custom price per stay when needed. Nothing is saved as you type: edit as many fields as you like, then press **Save changes** once (see below).
- **Bar & Restaurant** — a simple till for the bar and the restaurant. Orders can be charged to a checked-in guest's room (added to their bill automatically) or paid on the spot in cash or by card. Managers can edit the menu and void orders.
- **Beach umbrellas** — 39 numbered umbrellas by default. For any day, see which are free and who has which one — by room number for hotel guests, or by name for outside guests. Managers can change the umbrella count.
- **Email notifications** — every new reservation is emailed to the hotel's staff (and optionally to the guest), and says who made the booking. If email isn't configured, or sending fails, the reservation still goes through — the attempt is simply logged as "not sent" or "failed", visible on the **Staff & Email** screen.
- **Staff & Email (managers only)** — create, edit and remove staff accounts, reset passwords, see the email log and send a test email, and review recent activity.
- **Two ways in** — at sign-in, choose "Receptionist" or "Manager". Each account has one fixed role; picking the wrong one at login is rejected with a clear message, without revealing whether the account exists.

## Changes after the October 2026 review

- **Payments:** any whole amount in lek is accepted (the old "nearest valid value is 7401" browser error is gone). If an amount is too high, the dialog says exactly how much is still owed. Guests can also pay in **EUR, USD, GBP or CHF**; the amount is converted to lek with the rate of the day, and both are stored.
- **Exchange rates are automatic:** the server fetches them every 6 hours from open.er-api.com (free, no key). If the service can't be reached, the last saved rates stay in use. Managers can press **Update now** on the Prices page.
- **Light theme only** — the dark mode was removed.
- **Beach as a map:** the river on top, Row 1 (front row) at the shore, then the rows behind. Managers set how many umbrellas go in each row.
- **Bar & Restaurant: one bill.** The tabs only switch the menu; the order keeps items from both. The server still records the bar part and the restaurant part separately so each has its own daily totals.
- **Reservation dialog:** two columns (details on the left, payments on the right) so nothing needs scrolling, main buttons in one row and the rest under **More**.
- **Concierge requests** now go Open → In progress → Done (or Cancelled), and show who added or changed them and when.
- **Every page has its own address** (`/rooms`, `/reservations`, `/guests/<id>`, `/beach?date=…`, `/bar-restaurant`, `/prices`, `/staff`). Refresh keeps you on the same page; Back and Forward work.
- Favicon, cleaner drop-downs (arrow no longer squeezed against the edge), and a wider new-reservation form.

## Hotel rules built into the app

| What | Default |
|---|---|
| Rooms | 20: floor 1, rooms 101–110 (Standard); floor 2, rooms 201–210 (Family Duplex) |
| Capacity | Standard: 2 people. Family Duplex: 2 to 10 people |
| Standard price | 7,500 lek per night in September (≈ €82 at a rate of 91.5) |
| Family Duplex price | 7,500 lek for 2 people, plus **2,500 lek** for each extra person per night |
| Other months | Use the 7,500 lek base price until their own prices are set |
| Beach umbrellas | 39, numbered 1–39 |

Prices are calculated night by night, so a stay that crosses from one month into the next uses each month's own price. All of this is changed from the **Prices** screen (managers only), with no code changes needed. The logic lives in `public/pricing.js` and is used identically by the server and the browser.

> The 2,500 lek surcharge per extra person was a best guess from an unclear source figure. Check it under **Prices** before relying on it.

## Running it locally

Node.js 20 or newer is required.

```bash
npm install
cp .env.example .env        # fill in ADMIN_EMAIL and ADMIN_PASSWORD (min. 10 characters)
npm start                   # http://localhost:3000
```

In development (without `NODE_ENV=production`), `JWT_SECRET` is optional. In production it is required.

To try it out with fictional guests, reservations, bar orders and beach bookings:

```bash
npm run seed-demo           # only works on a database with no reservations yet
```

## Users and roles

The first manager account is created automatically from `ADMIN_EMAIL` and `ADMIN_PASSWORD` when there are no users yet — and, optionally, a first receptionist account from `RECEPTIONIST_EMAIL` and `RECEPTIONIST_PASSWORD`. After the first sign-in, change the password (the "Change password" button) and remove the `*_PASSWORD` values from `.env`.

To add another user from the command line:

```bash
npm run create-user -- reception@lege.al "First Last" receptionist
npm run create-user -- owner@lege.al "First Last" manager
```

Forgot a password, or not sure which emails exist?

```bash
npm run reset-password -- someone@example.com   # asks for the new password; lists all accounts if the email is not found
```

New users can also be created by a manager right in the app, on the **Staff & Email** screen, or via the API (`POST /api/users`, see `docs/API.md`).

- **receptionist** — overview, rooms, reservations, check-in and check-out, payments, guests, concierge, room cleaning, beach umbrellas. Receptionists do not see Bar & Restaurant or Prices.
- **manager** — everything a receptionist can do, plus bar & restaurant orders, prices, room categories, the exchange rate, the menu, voiding orders, the activity log, staff accounts and email notification settings.

## Email notifications

Without an SMTP server configured, the app works exactly as before — reservations are created normally — but nobody is emailed, and every attempt is recorded as "not sent" so you can see that on the **Staff & Email** screen.

To turn email on, set these in `.env` and restart the server:

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASS=your-smtp-password
MAIL_FROM="Hotel Lege <reservations@lege.al>"
NOTIFY_EMAILS=owner@lege.al,manager@lege.al   # optional; empty = all managers
```

Then use "Send a test email to me" on the **Staff & Email** screen to confirm it works.

## A separate frontend

If you build your own frontend (React, Vue, a mobile app), it signs in with email, password **and the chosen role**, and gets back a **token** to send with every other request. The login response includes the account's role (`manager` or `receptionist`), for the frontend to show or hide sections accordingly.

1. Set the frontend's address in `.env`: `CORS_ORIGINS=http://localhost:5173,https://panel.lege.al`
2. Copy `docs/lege-client.mjs` into your frontend.
3. Read `docs/API.md` for every route, rule and example.

The built-in interface (`public/`) keeps working exactly the same and using it is not required.

## Deploying to production

The app must run **behind HTTPS**. Without HTTPS the session cookie is not set (it is `secure` in production).

### Docker (recommended)

```bash
cp .env.example .env         # set JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d --build
```

Data is stored in the `lege-data` volume (`/data/lege.db`). Put a reverse proxy with HTTPS in front of it, e.g. Caddy, which gets a certificate automatically:

```
lege.example.com {
    reverse_proxy localhost:3000
}
```

If you're testing in Docker over `http://localhost`, set `COOKIE_SECURE=false` in `.env` (for testing only).

### Without Docker (a VPS)

```bash
npm ci --omit=dev
NODE_ENV=production node server/index.js     # or run it with pm2 / systemd
```

### Backups

```bash
npm run backup        # creates data/backups/lege-YYYYMMDD-HHMMSS.db without stopping the server
```

Schedule this nightly with `cron` and copy the files off the server. The database is gone for good if the disk fails, so this step isn't optional.

## Structure

```
server/          API, authentication, business logic, database, CLI scripts
  beach.js         beach umbrella booking
  pos.js           bar & restaurant orders and the menu
  mailer.js        SMTP wrapper (nodemailer)
  notifications.js reservation-created emails and the email log
public/          the built-in interface (index.html, app.js, prices.js, fnb.js, beach.js, staff.js, styles.css) and pricing.js (shared with the server)
test/            automated tests
.github/         CI that runs the tests on every push
```

## What it still doesn't do (possible next steps)

- **Fiscal invoicing:** it doesn't issue tax-valid invoices. For Albania this would need integration with the fiscal invoicing system.
- **Refunds:** payments are recorded, but there's no negative payment. If a guest leaves early, the app shows how much is owed back, but the refund itself isn't recorded.
- **Channel manager and online booking:** it doesn't connect to Booking.com or Airbnb, and there's no booking page for guests. Reservations are entered by the front desk.
- **Full housekeeping:** a room only has a clean/dirty status, nothing more detailed.
- **One hotel, one server:** SQLite suits a single 20-room hotel. Multiple hotels would need PostgreSQL and data separated per hotel.
- **SMS confirmations:** only email notifications exist, not SMS.
- **GDPR:** there's no export or deletion of a guest's data on request yet.

## Putting it on GitHub

1. Create an empty **private** repository on github.com (no README, no .gitignore).
2. In the project folder:

```bash
git init
git add .
git commit -m "Lege: first version"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/lege-hotel.git
git push -u origin main
```

`.gitignore` excludes `.env`, `node_modules` and `data/`, so passwords, keys and guest data are never pushed to the repository. **Don't remove these rules.** On GitHub, the tests will run automatically under the Actions tab.
