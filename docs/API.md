# Lege API

This document is for anyone building a separate frontend (React, Vue, a mobile app, etc.) on top of this backend.
The built-in interface (`public/`) uses this exact API, so everything here is proven in real use.

- **Base:** `https://your-server/api`
- **Format:** JSON, both request and response (`Content-Type: application/json`)
- **Dates:** `YYYY-MM-DD` (e.g. `2026-09-18`). `arr` is the first night, `dep` is the day of departure (the last night is `dep - 1`).
- **Money:** whole numbers in **lek**. Euro is shown only as a guide, using the `fx` rate.
- **Errors:** a proper HTTP status code and a body of `{ "error": "A message in English" }`. The message is ready to show the user as-is.

## 1. Connecting your frontend

1. In the server's `.env`, add your frontend's address (no trailing `/`, no `*`):
   ```
   CORS_ORIGINS=http://localhost:5173,https://panel.lege.al
   ```
   Without this, the browser blocks requests from a different origin.
2. Copy `docs/lege-client.mjs` into your project and use it:
   ```js
   import { createClient } from './lege-client.mjs';

   export const api = createClient({
     baseUrl: 'http://localhost:3000',          // the backend's address
     onUnauthorized: () => { /* send the user to the sign-in page */ },
   });

   const { user } = await api.login('reception@lege.al', 'password', 'receptionist');
   user.role;              // "manager" or "receptionist"
   const state = await api.get('/state');
   ```
3. In production, both the server and the frontend must be on **HTTPS**.

## 2. Users and roles

Sign-in is with **email, password, and the role chosen at the login screen**. Every account has one fixed role:

| Role | What it can do |
|---|---|
| `receptionist` | Reservations, check-in, check-out, payments, rooms (cleaning), guests, concierge requests, bar/restaurant orders, beach umbrellas |
| `manager` | Everything a receptionist can do, plus: prices, room categories, the exchange rate, the menu, voiding orders, the activity log, and user management |

Hide from the interface what a role can't do (e.g. the "Prices" section for a receptionist), but **don't rely on that alone** — the server rejects it with a `403` regardless.

## 3. Authentication

### `POST /auth/login`
```json
{ "email": "reception@lege.al", "password": "password", "role": "receptionist" }
```
`role` is `"manager"` or `"receptionist"` — whichever the person picked at the login screen. It is checked against the account's actual role **after** the password is verified, so a wrong role never reveals whether the account exists; it just returns a `403` with a message like "This is a Manager account. Select Manager to sign in."

`200` response:
```json
{
  "ok": true,
  "token": "eyJhbGciOi...",
  "expiresIn": 43200,
  "user": { "id": "…", "name": "Nova", "email": "reception@lege.al", "role": "receptionist" }
}
```
The token expires after 12 hours. Send it with every other request: `Authorization: Bearer <token>`.
Errors: `401` (wrong email or password), `403` (role mismatch), `429` (too many attempts: 20 per 15 minutes per IP).

### `GET /auth/me`
Returns `{ id, name, email, role }`. Use it to check whether the token is still valid when the app starts.

### `POST /auth/password`
```json
{ "current": "current-password", "next": "new-password-min-10-chars" }
```
After changing it, that account's old tokens stop working (on every device). Sign in again.

### `POST /auth/logout`
Clears the session cookie. For a token-based frontend, just discard the token client-side.

## 4. Hotel state

### `GET /state`
Returns everything a screen needs: settings, rooms, guests, reservations, requests, the menu, and whether email is enabled. For a 20-room hotel this is small, so fetch it once and refresh it after every change.

```jsonc
{
  "me":    { "id": "…", "name": "…", "email": "…", "role": "manager" },
  "hotel": "Lege",
  "today": "2026-09-22",
  "fx":    91.5,                                   // lek per 1 euro
  "mailEnabled": false,                             // whether SMTP is configured
  "beachUmbrellas": 39,
  "cats":  { "std": { "name": "Standard", "cap": 2, "inc": 2, "extra": 0 },
             "dup": { "name": "Family Duplex", "cap": 10, "inc": 2, "extra": 2500 } },
  "prices":{ "std": { "def": 7500, "m": { "8": 7500 } }, "dup": { … } },   // m: month 0-11 (8 = September)
  "rooms": [ { "id": "101", "floor": 1, "cat": "std", "dirty": false }, … ],
  "guests":[ { "id": "…", "name": "…", "phone": "", "email": "", "notes": "", "points": 0, "visits": 0, "prefs": [] }, … ],
  "res":   [ { "id": "…", "guestId": "…", "roomId": "201", "arr": "2026-09-18", "dep": "2026-09-21",
               "status": "confirmed",              // confirmed | checkedin | checkedout | cancelled
               "source": "Direct", "adults": 4, "custom": 0, "notes": "",
               "paid": 7500, "pays": [ { "amount": 7500, "method": "cash", "at": "2026-09-18T09:00:00.000Z" } ],
               "charges": [ { "outlet": "bar", "total": 1500, "items": [ { "name": "Aperol Spritz", "qty": 2 } ], "at": "…" } ],
               "chargesTotal": 1500 }, … ],
  "reqs":  [ { "id": "…", "guestId": "…", "type": "Transport", "note": "…", "done": false, "day": "2026-09-18" }, … ],
  "menu":  [ { "id": "…", "outlet": "bar", "section": "Coffee", "name": "Espresso", "price": 150, "active": true }, … ]
}
```

## 5. Prices

The price per night = the category's base price for that night's month + (people over the number included, `inc`) × `extra`.
If a month has no price set, `def` is used. If a reservation has `custom > 0`, that is the fixed price per night instead.

To show a price before saving a reservation, use the same module the server uses, `public/pricing.js`:
```js
const total = Pricing.totalWith(state, room.cat, { arr, dep, adults, custom });   // state has cats and prices
```
The server always recalculates it, so that remains the source of truth.

### `PUT /pricing` (manager only) — the "Save" button
Saves the exchange rate, any number of category fields, and any number of monthly prices in **one atomic transaction** — either everything is saved, or nothing is (e.g. if one price is invalid).
```json
{
  "fx": 91.5,
  "categories": { "std": { "name": "Standard", "cap": 2, "inc": 2, "extra": 0 } },
  "prices": [ { "cat": "std", "month": 8, "amount": 7500 }, { "cat": "dup", "month": "def", "amount": 8000 } ]
}
```
`fx`, `categories` and `prices` are all optional; send only what changed. `month` is `0`–`11` or `"def"` for the base price. `amount: null` removes that month's price (falls back to the base price). Up to 500 price entries per call.

There are also single-field routes the built-in interface no longer uses but that remain available: `PUT /settings` (`{ "fx": 91.5, "hotelName": "Lege", "beachUmbrellas": 40 }`), `PUT /categories/:key`, and `PUT /prices` (one `{ "cat", "month", "amount" }` at a time).

## 6. Reservations

### `POST /reservations`
```json
{
  "guestName": "Arben Krasniqi",      // required; if a guest with this name exists, it's linked to them
  "phone": "+355 69 000 0000",
  "email": "arben@example.com",       // optional; needed for a guest confirmation email
  "roomId": "201",
  "arr": "2026-09-18",
  "dep": "2026-09-21",
  "adults": 4,
  "source": "Direct",                 // Direct | Phone | Booking.com | Airbnb | Agency | Other
  "custom": 0,                        // optional: fixed price per night (lek)
  "notes": "Child's bed",
  "deposit": 5000,                    // optional: deposit paid now
  "notifyGuest": true                 // optional: also email the guest a confirmation (needs email)
}
```
Response: `{ "id": "…" }`. The staff (or `NOTIFY_EMAILS`) are emailed automatically in the background — this never blocks or fails the reservation, even if sending fails. Server rules:
- `409` if the room is already booked for those dates. A checkout and a check-in on the same day are both allowed.
- `400` if the number of people exceeds the room's capacity, if `dep <= arr`, or if the stay exceeds 120 nights.

### `PATCH /reservations/:id`
The same fields as above (without `deposit` or `notifyGuest`). A closed (`checkedout`) or cancelled reservation can't be changed: `409`.

### Actions
All are `POST` with no body:

| Route | Rule | Response |
|---|---|---|
| `/reservations/:id/checkin` | Only from `confirmed`. **`409` if the room isn't clean.** | `{}` |
| `/reservations/:id/checkout` | Only from `checkedin`. The room becomes dirty, the guest earns points (1 point per 100 lek). Leaving before the planned date shortens the stay. | `{ "points": 150, "shortened": false, "balance": 0 }` |
| `/reservations/:id/cancel` | Only from `confirmed` | `{}` |
| `/reservations/:id/restore` | Only from `cancelled`; `409` if the room was taken in the meantime | `{}` |

### `POST /reservations/:id/payments`
```json
{ "amount": 12000, "method": "card" }       // method: cash | card | transfer
```
`409` if the amount would exceed the total owed (room + any bar/restaurant charges). Payments can't be deleted or edited.

## 7. Rooms, guests, concierge

| Route | Body | Note |
|---|---|---|
| `POST /rooms/:id/clean` | | Marks the room ready |
| `POST /rooms/:id/dirty` | | `409` if a guest is currently in the room |
| `PATCH /guests/:id` | `{ "notes": "…", "phone": "…", "email": "…", "prefs": ["High floor"] }` | Every field is optional. `prefs` replaces the whole list. |
| `POST /requests` | `{ "guestId": "…", "type": "Transport", "note": "Taxi at 07:00" }` | `type`: Transport, Restaurant, Room service, Excursion, Other |
| `POST /requests/:id/done` | | |

## 8. Beach umbrellas

Every umbrella is numbered `1..N` (39 by default, changeable by a manager).

### `GET /beach?date=2026-09-18`
```jsonc
{ "date": "2026-09-18", "total": 39, "taken": 8, "free": 31,
  "spots": [ { "spot": 1, "booking": null },
             { "spot": 3, "booking": { "id": "…", "guestName": "Sofia Nilsson", "roomId": "101", "reservationId": "…", "note": "" } }, … ] }
```
`booking.roomId`/`reservationId` are set only for a hotel guest; otherwise the umbrella was booked by name (a walk-in).

### `POST /beach/bookings`
```json
{ "spot": 5, "from": "2026-09-18", "to": "2026-09-20", "reservationId": "…", "notes": "" }
```
Either `reservationId` (the reservation must be `confirmed` or `checkedin`, and the dates must fall within its stay) **or** `guestName` instead — not both. `to` defaults to `from`. Rules: `400` for an invalid spot number or dates spanning more than 60 days; `409` if that umbrella is already booked for an overlapping date, or if the reservation isn't active.

### `DELETE /beach/bookings/:id`
Releases the umbrella.

## 9. Bar and restaurant

### `GET /orders?date=2026-09-18&outlet=bar`
`outlet` is optional (`bar` or `restaurant`); omit it for both. Returns the day's orders with totals by room/cash/card.

### `POST /orders`
```json
{
  "outlet": "bar",                              // bar | restaurant
  "items": [ { "id": "bar-espresso", "qty": 2 } ],   // up to 40 different items; price always comes from the server's menu
  "destination": "room",                        // "room" (needs reservationId) or "paid" (needs method)
  "reservationId": "…",                         // required when destination is "room"; must be checkedin
  "method": "cash",                              // required when destination is "paid": cash | card
  "label": "Terrace 4",                          // optional, shown on the order (e.g. a table name)
  "note": "no ice"                               // optional
}
```
`409` if an item isn't active on the menu, or the reservation isn't checked in. The room charge is added to that reservation's bill automatically (see `charges`/`chargesTotal` in `GET /state`).

### `POST /orders/:id/void` (manager only)
`409` if the guest already checked out.

### Menu (manager only)
| Route | Body |
|---|---|
| `POST /menu` | `{ "outlet": "bar", "section": "Coffee", "name": "Espresso", "price": 150, "active": true }` |
| `PATCH /menu/:id` | Any of the same fields |
| `DELETE /menu/:id` | |

## 10. Manager only

| Route | Body |
|---|---|
| `GET /activity` | Returns the last 100 actions: who, what, when |
| `GET /notifications` | `{ "enabled": true, "from": "…", "recipients": ["…"], "log": [ { "at", "kind", "recipient", "subject", "status", "error" } ] }` |
| `POST /notifications/test` | Sends a test email to the signed-in manager. Returns `{ "status": "sent" \| "failed" \| "skipped" }` |

### Users
| Route | Body | Note |
|---|---|---|
| `GET /users` | | List, without passwords |
| `POST /users` | `{ "email": "…", "name": "…", "password": "min. 10 characters", "role": "receptionist" }` | `409` if the email already exists |
| `PATCH /users/:id` | `{ "name": "…", "role": "manager" }` | `409` if it would leave no manager |
| `POST /users/:id/password` | `{ "password": "…" }` | That user's old tokens stop working |
| `DELETE /users/:id` | | Can't delete yourself, or the last manager |

## 11. Error codes

| Code | Meaning |
|---|---|
| `400` | Invalid data (the message says what) |
| `401` | Not signed in, or the token expired. Send the user to the login screen. |
| `403` | The role doesn't allow this action, the login role didn't match the account, or the origin isn't in `CORS_ORIGINS` |
| `404` | Not found |
| `409` | Conflict with the current state (room taken, room not clean, payment over the total, umbrella already booked, etc.) |
| `429` | Too many sign-in attempts |

## 12. Example: protecting pages by role (React)

```jsx
import { api } from './api';

function RequireRole({ role, children }) {
  if (!api.isLoggedIn) return <Navigate to="/login" />;
  if (role && api.user.role !== role) return <p>You don't have access to this page.</p>;
  return children;
}

// <Route path="/prices" element={<RequireRole role="manager"><Prices /></RequireRole>} />
// <Route path="/reservations" element={<RequireRole><Reservations /></RequireRole>} />
```

## 13. Security

- The token grants full access for that role until it expires. Don't log it, and don't put it in a URL.
- Storing it in `sessionStorage` is reasonable, but an XSS bug in the frontend would expose it. Don't load unnecessary third-party scripts.
- Changing a password (by the user or a manager) immediately invalidates that account's old tokens.
- Only put your own addresses in `CORS_ORIGINS`.


## Added in October 2026

- `POST /reservations/:id/payments` accepts an optional `currency` (`ALL` default, or `EUR`, `USD`, `GBP`, `CHF`). For a foreign currency, `amount` is in that currency (up to 2 decimals) and is converted to lek with the stored rate. The response is `{ amount (lek), currency, foreignAmount, rate, remaining }`. Each entry of `res[].pays` in `/state` now has `currency`, `foreignAmount` and `rate`.
- `GET /fx` → `{ rates: { EUR, USD, GBP, CHF }, updated }` (lek per 1 unit). `POST /fx/refresh` (manager) fetches new rates now. `/state` includes `fxRates` and `fxUpdated`. The rates are fetched automatically every 6 hours; `fx` (lek per euro) is kept for compatibility.
- `POST /orders` without `outlet` (or `"outlet": "mixed"`) accepts bar and restaurant items in one order. It is saved as one order per outlet; the response has `orders: [{ id, outlet, total }]` and the overall `total`.
- `POST /requests/:id/status` with `{ "status": "open" | "progress" | "done" | "cancelled" }`. `/state` requests now include `status`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`. `POST /requests` returns `{ id }`.
- `PUT /settings` accepts `beachPerRow`. `GET /beach` returns `perRow`, `rows`, and `row` / `pos` for every umbrella (row 1 is the front row).
- Every non-API address without a file extension returns the app (`index.html`), so pages like `/rooms` or `/guests/<id>` can be refreshed or bookmarked.
