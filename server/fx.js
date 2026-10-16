/**
 * Exchange rates, fetched automatically from a free public API (no key needed) instead of being typed in by the manager.
 * Source: https://open.er-api.com (ExchangeRate-API, open access, updated once a day, includes the Albanian lek).
 *
 * Everything is stored as "lek per 1 unit of the currency" in the settings table:
 *   fx          lek per 1 euro (kept for older code and the API)
 *   fx_rates    JSON, e.g. {"EUR":97.1,"USD":86.9,"GBP":113.4,"CHF":104.2}
 *   fx_updated  when the provider last updated the rates (ISO date)
 * If the API cannot be reached, the last saved rates stay in use.
 */
const { nowIso } = require('./util');

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];
const DEFAULT_URL = 'https://open.er-api.com/v6/latest/EUR';
const SIX_HOURS = 6 * 60 * 60 * 1000;

const round4 = (n) => Math.round(n * 10000) / 10000;

/** Downloads the latest rates and returns { rates: { EUR: lekPerEuro, ... }, updated }. Throws on any problem. */
async function fetchRates({ url = DEFAULT_URL, fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Exchange-rate service answered ${res.status}.`);
  const data = await res.json();
  const r = data && data.rates;
  if (!r || !(r.ALL > 0)) throw new Error('The exchange-rate service did not return a rate for the lek.');
  const rates = {};
  for (const c of CURRENCIES) if (r[c] > 0) rates[c] = round4(r.ALL / r[c]);
  if (!rates.EUR) throw new Error('The exchange-rate service did not return a rate for the euro.');
  const t = data.time_last_update_unix ? new Date(data.time_last_update_unix * 1000) : new Date();
  return { rates, updated: t.toISOString() };
}

function saveRates(db, { rates, updated }) {
  const set = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  db.transaction(() => {
    set.run('fx', String(rates.EUR));
    set.run('fx_rates', JSON.stringify(rates));
    set.run('fx_updated', updated || nowIso());
  })();
}

/** Lek per 1 unit of each currency, from the database. EUR always comes from the "fx" setting. */
function getRates(db) {
  const get = (k) => (db.prepare('SELECT value FROM settings WHERE key=?').get(k) || {}).value;
  let rates = {};
  try { rates = JSON.parse(get('fx_rates') || '{}') || {}; } catch (_e) { rates = {}; }
  const eur = Number(get('fx'));
  if (eur > 0) rates.EUR = eur;
  return { rates, updated: get('fx_updated') || null };
}

/** Fetches and saves now. Returns the saved rates, or throws (the old rates stay). */
async function refresh(db, opts) {
  const r = await fetchRates(opts);
  saveRates(db, r);
  return r;
}

/** Updates the rates at start-up and then every 6 hours. Failures are logged and the last rates stay in use. */
function startAutoUpdate(db, opts = {}) {
  const run = () => refresh(db, opts)
    .then((r) => console.log(`Exchange rates updated: 1 EUR = ${r.rates.EUR} lek.`))
    .catch((e) => console.warn(`Could not update exchange rates (keeping the last ones): ${e.message}`));
  run();
  const t = setInterval(run, opts.intervalMs || SIX_HOURS);
  t.unref();
  return t;
}

module.exports = { CURRENCIES, DEFAULT_URL, fetchRates, saveRates, getRates, refresh, startAutoUpdate };
