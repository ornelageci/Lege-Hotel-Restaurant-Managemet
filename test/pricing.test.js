const test = require('node:test');
const assert = require('node:assert/strict');
const Pricing = require('../public/pricing.js');

const P = {
  cats: { std: { cap: 2, inc: 2, extra: 0 }, dup: { cap: 10, inc: 2, extra: 2500 } },
  prices: { std: { def: 7500, m: { 8: 7500, 9: 9000 } }, dup: { def: 7500, m: { 8: 7500 } } },
};

test('Standard in September costs 7,500 lek per night', () => {
  assert.equal(Pricing.unit(P, 'std', '2026-09-15', 2), 7500);
});
test('Duplex with 2 people costs the base price', () => {
  assert.equal(Pricing.unit(P, 'dup', '2026-09-15', 2), 7500);
});
test('Duplex: every person above 2 adds the extra-person price', () => {
  assert.equal(Pricing.unit(P, 'dup', '2026-09-15', 6), 7500 + 4 * 2500);
  assert.equal(Pricing.unit(P, 'dup', '2026-09-15', 10), 7500 + 8 * 2500);
});
test('A month without a price uses the base price', () => {
  assert.equal(Pricing.unit(P, 'dup', '2026-03-10', 2), 7500);
});
test('A stay that crosses into another month is priced night by night', () => {
  const x = { arr: '2026-09-29', dep: '2026-10-02', adults: 2, custom: 0 };
  assert.equal(Pricing.totalWith(P, 'std', x), 7500 + 7500 + 9000);
});
test('A custom price per night overrides the automatic prices', () => {
  const x = { arr: '2026-09-29', dep: '2026-10-02', adults: 2, custom: 5000 };
  assert.equal(Pricing.totalWith(P, 'std', x), 15000);
});
test('Dates: validation and calculation independent of the time zone', () => {
  assert.ok(Pricing.isDate('2026-02-28'));
  assert.ok(!Pricing.isDate('2026-02-30'));
  assert.ok(!Pricing.isDate('2026-2-3'));
  assert.equal(Pricing.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(Pricing.diffDays('2026-03-28', '2026-03-30'), 2); // daylight saving change
});
