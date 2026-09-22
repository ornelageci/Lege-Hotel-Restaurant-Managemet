/*
 * Pricing logic. Used by both the server (Node) and the browser,
 * so the price the receptionist sees is exactly the price the server calculates.
 *
 * Price per night = the category's base price for the month of that night
 *                   + (people above the included number) × price per extra person.
 * A month without its own price uses the base price ("def").
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Pricing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const pad = (n) => String(n).padStart(2, '0');
  const parts = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
  const dayNum = (s) => { const { y, m, d } = parts(s); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };

  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const { y, m, d } = parts(s);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function addDays(s, n) {
    const { y, m, d } = parts(s);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }
  const diffDays = (a, b) => dayNum(b) - dayNum(a);
  const monthOf = (s) => parts(s).m - 1;

  /** P = { cats: {key:{cap,inc,extra}}, prices: {key:{def, m:{0..11: amount}}} } */
  function unit(P, cat, date, adults) {
    const c = P.cats[cat];
    const p = P.prices[cat];
    const v = p.m[monthOf(date)];
    const base = v !== undefined && v !== null && v !== '' ? +v : +p.def;
    const extraPeople = Math.max(0, (+adults || c.inc) - c.inc);
    return base + extraPeople * (+c.extra || 0);
  }
  function nightsOf(x) { return Math.max(0, diffDays(x.arr, x.dep)); }

  /** Total of a stay, night by night. If x.custom > 0 it is a fixed price per night. */
  function totalWith(P, cat, x) {
    const n = nightsOf(x);
    if (+x.custom > 0) return n * +x.custom;
    let s = 0;
    for (let i = 0; i < n; i++) s += unit(P, cat, addDays(x.arr, i), x.adults);
    return s;
  }
  return { unit, totalWith, nightsOf, addDays, diffDays, monthOf, isDate };
});
