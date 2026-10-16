/* Lege · user interface (core). All data comes from the API; nothing is stored in the browser except the last sign-in role.
 * Other sections live in prices.js, fnb.js, beach.js and staff.js. They register themselves in VIEWS / ACTIONS / HOOKS below. */

/* ---------- helpers ---------- */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SOURCES = ['Direct', 'Phone', 'Booking.com', 'Airbnb', 'Agency', 'Other'];
const REQ_TYPES = ['Transport', 'Restaurant', 'Room service', 'Excursion', 'Other'];
const TIERS = [
  { n: 'Silver', min: 0, c: 't0', perk: 'Welcome drink at the front desk.' },
  { n: 'Gold', min: 500, c: 't1', perk: 'Late check-out until 2:00 pm, free of charge.' },
  { n: 'Platinum', min: 1500, c: 't2', perk: 'Room upgrade when available and free late check-out.' },
];
const CW = { 7: 112, 14: 76, 30: 54 };
const ROLE_KEY = 'lege:loginRole';
const pad = (n) => String(n).padStart(2, '0');
const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return toStr(d); };
const diff = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const today = () => toStr(new Date());
const fmtD = (s) => { const d = parse(s); return `${d.getDate()} ${MON[d.getMonth()]}`; };
const fmtLong = (s) => { const d = parse(s); return `${DAYS_LONG[d.getDay()]}, ${d.getDate()} ${MON_LONG[d.getMonth()]}`; };
const num = (v) => Math.round(+v || 0).toLocaleString('en-US');
const money = (v) => `${num(v)} lek`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
const initials = (n) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const plural = (n, one, many) => (n === 1 ? one : many);

/* ---------- prices, state and API ---------- */
const { unit, totalWith, nightsOf } = Pricing;   // the same logic the server uses
let S = null;                                    // hotel state, fetched from the server

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch (_e) { /* no body */ }
  if (res.status === 401 && !path.startsWith('/auth/login')) { S = null; showLogin(); throw new Error('Your session expired. Please sign in again.'); }
  if (!res.ok) throw new Error((data && data.error) || 'Something went wrong. Please try again.');
  return data;
}
const post = (p, b) => api(p, { method: 'POST', body: b });
async function refresh() { S = await api('/state'); }

const UI = { view: 'overview', start: addDays(today(), -2), span: 14, gsel: null, gq: '' };

/* Extension points used by the other scripts */
const VIEWS = {};       // view name -> () => html
const ENTER = {};       // view name -> async () => load data, then render()
const AFTER = {};       // view name -> () => runs after the view was drawn
const ACTIONS = {};     // data-action name -> async (el, event) => void
const HOOKS = { change: [], input: [], submit: [], keydown: [], leave: [] };   // handlers return true when they handled the event

const guestOf = (id) => S.guests.find((g) => g.id === id);
const roomOf = (id) => S.rooms.find((r) => r.id === id);
const catOf = (r) => S.cats[r.cat];
const euro = (v) => Math.round((+v || 0) / (+S.fx || 91.5));
const both = (v) => `${money(v)} <small>(≈ €${num(euro(v))})</small>`;
const tierOf = (p) => { let t = TIERS[0]; TIERS.forEach((x) => { if (p >= x.min) t = x; }); return t; };
const nights = nightsOf;
const stayTotal = (x) => totalWith(S, roomOf(x.roomId).cat, x);       // the room only
const charges = (x) => +x.chargesTotal || 0;                          // bar and restaurant charged to the room
const total = (x) => stayTotal(x) + charges(x);                       // everything the guest owes
const balance = (x) => Math.max(0, total(x) - (+x.paid || 0));
const isAct = (x) => x.status !== 'cancelled';
const isManager = () => !!S && S.me.role === 'manager';
const STATUS_L = { confirmed: 'Confirmed', checkedin: 'In hotel', checkedout: 'Checked out', cancelled: 'Cancelled' };
const REQ_L = { open: 'Open', progress: 'In progress', done: 'Done', cancelled: 'Cancelled' };
const CUR = { ALL: { sym: 'lek', name: 'Lek' }, EUR: { sym: '€', name: 'Euro' }, USD: { sym: '$', name: 'US dollar' }, GBP: { sym: '£', name: 'Pound' }, CHF: { sym: 'CHF ', name: 'Swiss franc' } };
const rateOf = (cur) => (cur === 'ALL' ? 1 : +((S.fxRates || {})[cur]) || (cur === 'EUR' ? +S.fx : 0));
const fmtCur = (v, cur) => (cur === 'ALL' ? money(v) : `${CUR[cur].sym}${(+v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/* ---------- addresses (routing) ----------
 * Every section has its own URL, so the address bar changes, Back/Forward work and a refresh stays on the same page. */
const ROUTES = { overview: '/', rooms: '/rooms', res: '/reservations', guests: '/guests', fnb: '/bar-restaurant', beach: '/beach', prices: '/prices', staff: '/staff' };
function urlFor(view) {
  let p = ROUTES[view] || '/';
  const q = new URLSearchParams();
  if (view === 'guests' && UI.gsel) p += '/' + encodeURIComponent(UI.gsel);
  if (view === 'res') { if (UI.start !== addDays(today(), -2)) q.set('from', UI.start); if (UI.span !== 14) q.set('days', UI.span); }
  if (view === 'beach' && UI.beach && UI.beach.date && UI.beach.date !== today()) q.set('date', UI.beach.date);
  if (view === 'fnb' && UI.fnb && UI.fnb.date && UI.fnb.date !== today()) q.set('date', UI.fnb.date);
  const qs = q.toString();
  return p + (qs ? '?' + qs : '');
}
/** Reads the address bar into UI and returns the section to show. */
function readUrl() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const q = new URLSearchParams(location.search);
  let view = 'overview';
  for (const [v, p] of Object.entries(ROUTES)) if (p !== '/' && (path === p || path.startsWith(p + '/'))) view = v;
  const ok = (d) => d && Pricing.isDate(d);
  if (view === 'guests') { const id = path.startsWith('/guests/') ? decodeURIComponent(path.slice(8)) : ''; if (id) UI.gsel = id; }
  if (view === 'res') { UI.start = ok(q.get('from')) ? q.get('from') : addDays(today(), -2); UI.span = [7, 14, 30].includes(+q.get('days')) ? +q.get('days') : 14; }
  if (view === 'beach' && UI.beach) UI.beach.date = ok(q.get('date')) ? q.get('date') : today();
  if (view === 'fnb' && UI.fnb) UI.fnb.date = ok(q.get('date')) ? q.get('date') : today();
  return view;
}
function syncUrl(push) {
  const u = urlFor(UI.view);
  if (u === location.pathname + location.search) return;
  history[push ? 'pushState' : 'replaceState']({ view: UI.view }, '', u);
}
function stayNow(rid) {
  const t = today();
  const a = S.res.find((x) => x.roomId === rid && x.status === 'checkedin');
  if (a) return { res: a, kind: a.dep === t ? 'dep' : 'in' };
  const b = S.res.find((x) => x.roomId === rid && x.status === 'confirmed' && x.arr === t);
  if (b) return { res: b, kind: 'arr' };
  return null;
}
function med(g, size) {
  const t = tierOf(g.points);
  return `<span class="med ${t.c}" style="--s:${size}px" aria-hidden="true">${esc(initials(g.name))}</span>`;
}
const tierBadge = (g) => { const t = tierOf(g.points); return `<span class="tier ${t.c}">${t.n}</span>`; };

/* ---------- render ---------- */
function render() {
  $('brandName').textContent = (S.hotel || 'Lege').toUpperCase();
  $('whoName').textContent = S.me.name;
  $('whoRole').textContent = isManager() ? 'Manager' : 'Receptionist';
  document.querySelectorAll('[data-manager]').forEach((b) => { b.hidden = !isManager(); });
  if (!isManager() && document.querySelector(`.nav [data-view="${UI.view}"][data-manager]`)) UI.view = 'overview';   // e.g. a receptionist opening /bar-restaurant
  document.querySelectorAll('.nav button').forEach((b) => { if (b.dataset.view === UI.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  const cur = document.querySelector('.nav [aria-current="page"]'), nav = document.querySelector('.nav');
  if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2;
  $('main').innerHTML = VIEWS[UI.view]();
  if (AFTER[UI.view]) AFTER[UI.view]();
  syncUrl(false);   // keep the address bar in step (dates, selected guest...) without adding history entries
  const t = document.querySelector('.nav [aria-current="page"]');
  document.title = `${t && UI.view !== 'overview' ? t.textContent.trim() + ' · ' : ''}${S.hotel || 'Lege'} · Hotel Management`;
}
function head(title, sub, right) {
  const r = right === undefined ? '<button class="btn gold" data-action="newres">New reservation</button>' : right;
  return `<header class="pagehead"><div><h1>${title}</h1><p>${sub}</p></div><div class="head-r">${r}</div></header>`;
}
function greet() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

VIEWS.overview = function overviewHTML() {
  const t = today(), n = S.rooms.length;
  const tonight = S.res.filter((x) => isAct(x) && x.status !== 'checkedout' && x.arr <= t && t < x.dep);
  const occ = new Set(tonight.map((x) => x.roomId)).size;
  const pct = Math.round(occ / n * 100);
  const arrs = S.res.filter((x) => x.status === 'confirmed' && x.arr === t);
  const deps = S.res.filter((x) => x.status === 'checkedin' && x.dep === t);
  const rev = tonight.reduce((s, x) => s + (+x.custom > 0 ? +x.custom : unit(S, roomOf(x.roomId).cat, t, x.adults)), 0);
  const guestsIn = S.res.filter((x) => x.status === 'checkedin').reduce((s, x) => s + (+x.adults || 0), 0);
  const C = 2 * Math.PI * 24;
  const openReq = S.reqs.filter((q) => !q.done), doneReq = S.reqs.filter((q) => q.done);
  const vip = S.res.filter((x) => x.status === 'checkedin' && tierOf(guestOf(x.guestId).points).c === 't2');
  const row = (x, btn) => {
    const g = guestOf(x.guestId), r = roomOf(x.roomId);
    return `<div class="lrow">${med(g, 42)}<div class="who"><b>${esc(g.name)}</b><span>Room ${r.id}, ${x.adults} ${plural(x.adults, 'person', 'people')}, ${nights(x)} ${plural(nights(x), 'night', 'nights')}${balance(x) > 0 ? ', <span class="owes">owes ' + money(balance(x)) + '</span>' : ''}</span></div>${tierBadge(g)}${btn}</div>`;
  };
  return `${head(greet(), fmtLong(t) + ' ' + new Date().getFullYear())}
  <section class="metrics" aria-label="Today at a glance">
    <div class="metric"><svg class="ring" width="60" height="60" viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="24" stroke="var(--line)"/><circle cx="30" cy="30" r="24" stroke="var(--brass)" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}" transform="rotate(-90 30 30)"/></svg><div><b>${pct}%</b><span>Occupied tonight, ${occ} of ${n} rooms</span></div></div>
    <div class="metric"><div><b>${arrs.length}</b><span>Arrivals still to come today</span></div></div>
    <div class="metric"><div><b>${deps.length}</b><span>Departures today, ${guestsIn} ${plural(guestsIn, 'person', 'people')} in the hotel</span></div></div>
    <div class="metric"><div><b>${num(rev)}<small>lek</small></b><span>Room revenue tonight, ≈ €${num(euro(rev))}</span></div></div>
  </section>
  <div class="cols">
    <div>
      <h2 class="sec">Today's arrivals <small>${arrs.length} waiting</small></h2>
      ${arrs.length ? arrs.map((x) => row(x, `<button class="btn sm gold" data-action="checkin" data-id="${x.id}">Check in</button>`)).join('') : '<p class="none">All of today\'s guests have arrived.</p>'}
      <h2 class="sec gap">Today's departures <small>${deps.length} waiting</small></h2>
      ${deps.length ? deps.map((x) => row(x, `<button class="btn sm" data-action="checkout" data-id="${x.id}">Check out</button>`)).join('') : '<p class="none">No departures left.</p>'}
    </div>
    <div>
      <h2 class="sec">Concierge requests <small>${openReq.length} to do</small></h2>
      ${openReq.length ? openReq.map((q) => reqHTML(q, true)).join('') : '<p class="none">Nothing to do. Guests\' requests (taxi, table, room service…) appear here.</p>'}
      <p class="note">${doneReq.length ? doneReq.length + ' completed. ' : ''}<button class="btn text" data-action="newreq" style="padding:6px 0">Add request</button></p>
      <h2 class="sec gap">Platinum guests in the hotel</h2>
      ${vip.length ? vip.map((x) => { const g = guestOf(x.guestId); return `<div class="lrow link" data-action="gopen" data-id="${g.id}">${med(g, 38)}<div class="who"><b>${esc(g.name)}</b><span>Room ${x.roomId}, until ${fmtD(x.dep)}</span></div></div>`; }).join('') : '<p class="none">None at the moment.</p>'}
    </div>
  </div>`;
};

VIEWS.rooms = function roomsHTML() {
  const t = today();
  const inC = S.rooms.filter((r) => { const s = stayNow(r.id); return s && s.kind !== 'arr'; }).length;
  const arrC = S.rooms.filter((r) => { const s = stayNow(r.id); return s && s.kind === 'arr'; }).length;
  const dirtyC = S.rooms.filter((r) => r.dirty).length;
  const freeC = S.rooms.filter((r) => !stayNow(r.id) && !r.dirty).length;
  const floors = [2, 1].map((f) => {
    const rs = S.rooms.filter((r) => r.floor === f);
    const c = catOf(rs[0]);
    const price = unit(S, rs[0].cat, t, c.inc);
    const bays = rs.map((r) => {
      const s = stayNow(r.id), g = s ? guestOf(s.res.guestId) : null;
      let cls = 'bay';
      if (s && s.kind === 'arr') cls += ' arr'; else if (s) cls += ' in';
      if (r.dirty) cls += ' dirty';
      const label = s ? `${g.name}, ${s.res.adults} ${plural(s.res.adults, 'person', 'people')}, ${s.kind === 'arr' ? 'arriving today' : s.kind === 'dep' ? 'leaving today' : 'in the hotel'}` : (r.dirty ? 'needs cleaning' : 'free');
      return `<button class="${cls}" data-action="room" data-id="${r.id}" aria-label="Room ${r.id}, ${esc(label)}" title="${esc(label)}">
        ${s ? med(g, 34) : ''}${s && s.kind === 'dep' ? '<span class="tg">leaving</span>' : ''}${s && s.kind === 'arr' ? '<span class="tg">arriving</span>' : ''}
        ${s ? `<span class="pp">${s.res.adults}p</span>` : ''}<span class="no">${r.id}</span></button>`;
    }).join('');
    return `<div class="storey"><div class="slab"><b>Floor ${f}</b><span>${esc(c.name)}</span><span>${f === 2 ? 'from ' : ''}${num(price)} lek</span></div><div class="bays">${bays}</div></div>`;
  }).join('');
  return `${head('Rooms', 'The building tonight, by floor')}
  <div class="sumline"><span><b>${inC}</b>occupied</span><span><b>${arrC}</b>arriving today</span><span><b>${freeC}</b>free</span><span><b>${dirtyC}</b>to clean</span></div>
  <div class="fwrap"><div class="facade">
    <div class="pediment"><svg viewBox="0 0 820 96" preserveAspectRatio="none" aria-hidden="true"><path d="M0 96L410 8L820 96" fill="none" stroke="#C9A45C" stroke-opacity=".7" stroke-width="1.2" vector-effect="non-scaling-stroke"/><path d="M60 96L410 24L760 96" fill="none" stroke="#C9A45C" stroke-opacity=".35" stroke-width="1" vector-effect="non-scaling-stroke"/></svg><span>${esc((S.hotel || 'Lege').toUpperCase())}</span></div>
    ${floors}
    <div class="ground"><svg width="120" height="64" viewBox="0 0 120 64" aria-hidden="true"><path d="M8 64V28a52 52 0 0 1 104 0v36" fill="none" stroke="#C9A45C" stroke-width="1.2"/><path d="M22 64V30a38 38 0 0 1 76 0v34" fill="#ffffff10" stroke="#C9A45C" stroke-opacity=".6"/><path d="M60 8v56" stroke="#C9A45C" stroke-opacity=".5"/></svg></div>
  </div></div>
  <div class="legend"><span><i class="l-in"></i>In hotel</span><span><i class="l-arr"></i>Arriving today</span><span><i class="l-dirty"></i>To clean</span><span><i></i>Free</span></div>
  <p class="hint" style="text-align:center">Click a room for details, a reservation or cleaning. The number under the medallion is the number of people (p).</p>`;
};

VIEWS.res = function resHTML() {
  const t = today(), n = UI.span, cw = CW[n];
  const dates = Array.from({ length: n }, (_, i) => addDays(UI.start, i));
  const cc = (d) => (d === t ? ' td' : '') + ([0, 6].includes(parse(d).getDay()) ? ' wk' : '');
  const a = parse(dates[0]), b = parse(dates[n - 1]);
  const rng = `${a.getDate()} ${MON[a.getMonth()]} – ${b.getDate()} ${MON[b.getMonth()]} ${b.getFullYear()}`;
  const act = S.res.filter(isAct);
  const headRow = `<div class="row head"><div class="lab"><span>Room</span></div><div class="cells">${dates.map((d) => { const dt = parse(d); return `<div class="c dh${cc(d)}"><span>${DAYS[dt.getDay()]}</span><b>${dt.getDate()}</b></div>`; }).join('')}</div></div>`;
  const body = [1, 2].map((f) => {
    const rs = S.rooms.filter((r) => r.floor === f);
    const g = `<div class="row grp"><div class="lab" style="flex-basis:220px;width:220px"><b>Floor ${f}, ${esc(catOf(rs[0]).name)}</b></div><div class="cells">${dates.map((d) => `<div class="c${cc(d)}"></div>`).join('')}</div></div>`;
    const rows = rs.map((r) => {
      const cells = dates.map((d) => `<div class="c${cc(d)}" data-action="newres" data-room="${r.id}" data-date="${d}"></div>`).join('');
      const bars = act.filter((x) => x.roomId === r.id).map((x) => bar(x, n, cw)).join('');
      return `<div class="row rm"><div class="lab"><b>${r.id}</b><span>${num(unit(S, r.cat, t, catOf(r).inc))} lek</span></div><div class="cells">${cells}${bars}</div></div>`;
    }).join('');
    return g + rows;
  }).join('');
  return `${head('Reservations', 'Calendar of stays')}
  <div class="tools">
    <button class="btn" data-action="shift" data-n="-7" aria-label="Previous week">‹</button>
    <button class="btn" data-action="todaynav">Today</button>
    <button class="btn" data-action="shift" data-n="7" aria-label="Next week">›</button>
    <span class="rng">${rng}</span>
    <input type="date" id="jump" value="${UI.start}" aria-label="Go to date">
    <select id="span" aria-label="How many days">${[7, 14, 30].map((v) => `<option value="${v}"${v === n ? ' selected' : ''}>${v} days</option>`).join('')}</select>
    <div class="tl-leg"><span><i style="background:var(--brass-soft);border:1px solid var(--brass)"></i>Confirmed</span><span><i style="background:var(--in-bg)"></i>In hotel</span><span><i style="background:var(--line2)"></i>Checked out</span></div>
  </div>
  <div class="board" style="--cw:${cw}px">${headRow}${body}</div>
  <p class="hint">Click a free day for a new reservation, or an existing reservation for details. A red dot means an unpaid balance.</p>`;
};
function bar(x, n, cw) {
  const a = diff(UI.start, x.arr), d = diff(UI.start, x.dep);
  if (d < 0 || a >= n) return '';
  let l = (a + .5) * cw, r = (d + .5) * cw, cls = '';
  if (l < 0) { l = 0; cls += ' cl'; }
  if (r > n * cw) { r = n * cw; cls += ' cr'; }
  const g = guestOf(x.guestId), w = Math.max(20, r - l - 2);
  const owe = x.status !== 'checkedout' && balance(x) > 0;
  return `<button class="bar s-${x.status}${cls}${owe ? ' owe' : ''}" style="left:${l + 1}px;width:${w}px" data-action="opres" data-id="${x.id}" title="${esc(g.name)}, ${x.adults} ${plural(x.adults, 'person', 'people')}, ${fmtD(x.arr)} – ${fmtD(x.dep)}"><span>${esc(g.name)}</span>${w > 120 ? `<em>${x.adults}p</em>` : ''}</button>`;
}

VIEWS.guests = function guestsHTML() {
  const q = UI.gq.trim().toLowerCase();
  const list = S.guests.filter((g) => !q || `${g.name} ${g.phone}`.toLowerCase().includes(q)).sort((a, b) => b.points - a.points);
  if (!UI.gsel || !guestOf(UI.gsel)) UI.gsel = (list[0] || S.guests[0] || {}).id;
  return `${head('Guests', 'Guest book and loyalty programme')}
  <div class="split">
    <section aria-label="Guest list">
      <input class="gq" id="gq" type="search" placeholder="Search guests…" value="${esc(UI.gq)}" aria-label="Search guests">
      <div id="glist">${glistHTML(list)}</div>
    </section>
    <section id="gdet" aria-live="polite">${gdetHTML()}</section>
  </div>`;
};
function glistHTML(list) {
  if (!list.length) return '<p class="none">No guest matches.</p>';
  return list.map((g) => `<button class="grow" data-action="gsel" data-id="${g.id}" aria-current="${UI.gsel === g.id}">${med(g, 38)}<div style="flex:1;min-width:0"><b>${esc(g.name)}</b><span>${g.visits} ${plural(g.visits, 'visit', 'visits')}, ${num(g.points)} points</span></div>${tierBadge(g)}</button>`).join('');
}
function gdetHTML() {
  const g = guestOf(UI.gsel); if (!g) return '<p class="none">Select a guest.</p>';
  const t = tierOf(g.points), nx = TIERS[TIERS.indexOf(t) + 1];
  const pct = nx ? Math.min(100, Math.round((g.points - t.min) / (nx.min - t.min) * 100)) : 100;
  const stays = S.res.filter((x) => x.guestId === g.id).sort((a, b) => b.arr.localeCompare(a.arr));
  const reqs = S.reqs.filter((q) => q.guestId === g.id);
  return `<div class="gd-head">${med(g, 84)}<div><h2>${esc(g.name)}</h2><div class="pts">${tierBadge(g)} <span style="margin-left:6px">${num(g.points)} points, ${g.visits} ${plural(g.visits, 'visit', 'visits')}</span></div>
    <div class="prog"><i style="width:${pct}%"></i></div><small style="color:var(--muted)">${nx ? `${num(nx.min - g.points)} more points to reach ${nx.n}` : 'Highest level'}</small></div></div>
  <p class="perk"><b>${t.n}:</b> ${t.perk}</p>
  <div class="gd-grid">
    <div>
      <h2 class="sec" style="font-size:19px">Preferences</h2>
      <div class="chips">${g.prefs.length ? g.prefs.map((p, i) => `<span class="chip">${esc(p)}<button data-action="prefdel" data-i="${i}" aria-label="Remove ${esc(p)}">×</button></span>`).join('') : '<span class="none" style="padding:4px 0">No preferences recorded.</span>'}</div>
      <div class="inl"><input id="pref" placeholder="Add a preference" aria-label="Add a preference"><button class="btn sm" data-action="prefadd">Add</button></div>
      <h2 class="sec" style="font-size:19px;margin-top:26px">Notes</h2>
      <textarea class="nt" id="gnote" rows="3" aria-label="Notes about the guest">${esc(g.notes)}</textarea>
      <p class="note">${esc(g.phone || 'No phone recorded')}${g.email ? ' · ' + esc(g.email) : ''}</p>
    </div>
    <div>
      <h2 class="sec" style="font-size:19px">Stays</h2>
      ${stays.length ? stays.map((x) => `<div class="stay" data-action="opres" data-id="${x.id}"><b>${fmtD(x.arr)} – ${fmtD(x.dep)}</b> <span class="badge s-${x.status}" style="margin-left:6px">${STATUS_L[x.status]}</span><span>Room ${x.roomId}, ${x.adults} ${plural(x.adults, 'person', 'people')}, ${nights(x)} ${plural(nights(x), 'night', 'nights')}, ${money(total(x))}</span></div>`).join('') : '<p class="none">No stays yet.</p>'}
      <h2 class="sec" style="font-size:19px;margin-top:26px">Concierge requests <small><button class="btn sm" data-action="newreq" data-id="${g.id}">+ New request</button></small></h2>
      <p class="note" style="margin:4px 0 2px">What the guest asked the front desk for: a taxi, a table, room service… Press <b>Start</b> when someone is on it and <b>Done</b> when it is finished.</p>
      ${reqs.filter((q) => !q.done).map((q) => reqHTML(q, false)).join('') || '<p class="none">No open requests.</p>'}
      ${reqs.some((q) => q.done) ? `<details class="olds"><summary>${reqs.filter((q) => q.done).length} completed</summary>${reqs.filter((q) => q.done).map((q) => reqHTML(q, false)).join('')}</details>` : ''}
    </div>
  </div>
  <div style="margin-top:28px"><button class="btn gold" data-action="newres" data-guest="${g.id}">New reservation for ${esc(g.name.split(' ')[0])}</button></div>`;
}

/** One concierge request with its status and the buttons to move it along. */
function reqHTML(q, withGuest) {
  const g = guestOf(q.guestId);
  const s = g && S.res.find((x) => x.guestId === g.id && x.status === 'checkedin');
  const st = q.status || (q.done ? 'done' : 'open');
  let who = `Added ${fmtWhen(q.createdAt)}${q.createdBy ? ' by ' + esc(q.createdBy) : ''}`;
  if (q.updatedAt && st !== 'open') who += ` · ${REQ_L[st].toLowerCase()} ${fmtWhen(q.updatedAt)}${q.updatedBy ? ' by ' + esc(q.updatedBy) : ''}`;
  const b = (to, label, cls = '') => `<button class="btn sm ${cls}" data-action="reqst" data-id="${q.id}" data-st="${to}">${label}</button>`;
  const acts = st === 'open' ? b('progress', 'Start') + b('done', 'Done', 'gold')
    : st === 'progress' ? b('done', 'Done', 'gold') + b('open', 'Back to open', 'text')
      : b('open', 'Reopen', 'text');
  const cancel = st === 'open' || st === 'progress' ? `<button class="rq-x" data-action="reqst" data-id="${q.id}" data-st="cancelled" title="Cancel this request" aria-label="Cancel this request">×</button>` : '';
  return `<div class="rq rq-${st}">
    <div class="rq-main"><b>${esc(q.type)}${withGuest && g ? `<span class="rq-g">, ${esc(g.name)}${s ? ' · Room ' + s.roomId : ''}</span>` : ''}</b>
      <span class="rstat ${st}">${REQ_L[st]}</span>
      ${q.note ? `<p>${esc(q.note)}</p>` : ''}<small>${who}</small></div>
    <div class="rq-acts">${acts}${cancel}</div></div>`;
}

/* ---------- dialogs ---------- */
/** Shows the details dialog. Wide dialogs lay their content out in two columns so nothing needs scrolling. */
function showDetails(html, wide) {
  const d = $('dlgD');
  d.classList.toggle('wide', !!wide);
  d.innerHTML = html;
  if (!d.open) d.showModal();
}
function payHint(f) {
  const id = f.dataset.id, x = S.res.find((r) => r.id === id); if (!x) return;
  const cur = f.cur.value, rate = rateOf(cur), bal = balance(x);
  const v = parseAmount(f.amt.value, cur);
  const lek = cur === 'ALL' ? v : Math.round(v * rate);
  let h;
  if (cur === 'ALL') h = `Still to pay ${money(bal)} (≈ €${num(euro(bal))}).`;
  else h = v > 0 ? `${fmtCur(v, cur)} = <b>${money(lek)}</b> at today's rate (1 ${cur} = ${rate.toLocaleString('en-US', { maximumFractionDigits: 2 })} lek). Still to pay ${fmtCur(bal / rate, cur)}.` : `Still to pay ${fmtCur(bal / rate, cur)} (${money(bal)}).`;
  $('payHint').innerHTML = h;
  $('payErr').textContent = '';
}
/** "7,500" -> 7500 for lek; "77,25" or "77.25" -> 77.25 for other currencies. */
function parseAmount(raw, cur) {
  let t = String(raw || '').trim().replace(/\s/g, '');
  if (cur === 'ALL') t = t.replace(/[,.](?=\d{3}\b)/g, '');
  else if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
function openRes(id) {
  const x = S.res.find((r) => r.id === id); if (!x) return;
  const g = guestOf(x.guestId), r = roomOf(x.roomId), c = catOf(r), bal = balance(x), tt = total(x), st = stayTotal(x), n = nights(x);
  // Main actions in one row; the rest go in a "More" menu so the dialog is not a wall of buttons.
  let acts = '';
  if (x.status === 'confirmed') acts += `<button class="btn gold" data-action="checkin" data-id="${x.id}">Check in</button>`;
  if (x.status === 'checkedin') acts += `<button class="btn gold" data-action="checkout" data-id="${x.id}">Check out</button>`;
  if (x.status === 'cancelled') acts += `<button class="btn gold" data-action="restore" data-id="${x.id}">Restore</button>`;
  if (x.status !== 'checkedout' && x.status !== 'cancelled') acts += `<button class="btn" data-action="edit" data-id="${x.id}">Edit</button>`;
  let more = '';
  if (x.status === 'checkedin' && isManager()) more += `<button data-action="fnb-for" data-id="${x.id}">Bar / restaurant order</button>`;
  if (x.status === 'confirmed' || x.status === 'checkedin') more += `<button data-action="beach-for" data-id="${x.id}">Beach umbrella</button>`;
  more += `<button data-action="gopen" data-id="${g.id}">Guest profile</button>`;
  if (x.status === 'confirmed') more += `<button class="danger" data-action="cancel" data-id="${x.id}">Cancel reservation</button>`;
  acts += `<details class="more"><summary class="btn">More <span aria-hidden="true">▾</span></summary><div class="menu">${more}</div></details>`;
  const PAY_L = { cash: 'Cash', card: 'Card', transfer: 'Bank transfer' };
  const OUT_L = { bar: 'Bar', restaurant: 'Restaurant' };
  const when = (at) => new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const payRows = (x.pays || []).map((p) => `<div class="stay" style="cursor:default"><b>${money(p.amount)}</b> <span class="badge" style="margin-left:6px">${PAY_L[p.method] || esc(p.method)}</span>${p.currency && p.currency !== 'ALL' ? ` <span class="badge cur">${fmtCur(p.foreignAmount, p.currency)}</span>` : ''}<span>${when(p.at)}${p.currency && p.currency !== 'ALL' ? ` · 1 ${p.currency} = ${p.rate} lek` : ''}</span></div>`).join('');
  const chargeRows = (x.charges || []).map((c2) => `<div class="stay" style="cursor:default"><b>${money(c2.total)}</b> <span class="badge" style="margin-left:6px">${OUT_L[c2.outlet] || esc(c2.outlet)}</span><span>${c2.items.map((i) => `${i.qty}× ${esc(i.name)}`).join(', ')} · ${when(c2.at)}</span></div>`).join('');
  const curOpts = Object.keys(CUR).filter((k) => k === 'ALL' || rateOf(k) > 0).map((k) => `<option value="${k}">${k === 'ALL' ? 'Lek' : k}</option>`).join('');
  const payForm = (bal > 0 && x.status !== 'cancelled') ? `<form class="payf" data-id="${x.id}" novalidate>
      <div class="payrow"><input type="text" inputmode="decimal" name="amt" value="${bal}" aria-label="Amount" autocomplete="off">
      <select name="cur" aria-label="Currency">${curOpts}</select>
      <select name="m" aria-label="Payment method"><option value="cash">Cash</option><option value="card">Card</option><option value="transfer">Bank transfer</option></select></div>
      <p class="payhint" id="payHint"></p><p class="err" id="payErr" role="alert"></p>
      <button class="btn gold" type="submit">Record payment</button></form>` : '';
  const sub = (t) => `<h3 class="dsub">${t}</h3>`;
  const payBlock = `${sub('Payments')}${payRows || '<p class="none" style="padding:6px 0">No payments recorded yet.</p>'}${payForm}`;
  const chargeBlock = chargeRows ? `${sub('Charged to the room')}${chargeRows}` : '';
  showDetails(`<div class="dh2"><div class="ttl">${med(g, 56)}<div><h2>${esc(g.name)}</h2><p>${tierBadge(g)} Room ${r.id}, ${esc(c.name)} <span class="badge s-${x.status}" style="margin-left:6px">${STATUS_L[x.status]}</span></p></div></div><button class="x" data-action="close" aria-label="Close">×</button></div>
  <dl class="facts rd-facts">
    <div><dt>Arrival</dt><dd>${fmtLong(x.arr)}</dd></div><div><dt>Departure</dt><dd>${fmtLong(x.dep)}</dd></div>
    <div><dt>Stay</dt><dd>${n} ${plural(n, 'night', 'nights')}, ${x.adults} ${plural(x.adults, 'person', 'people')}</dd></div><div><dt>Source</dt><dd>${esc(x.source)}</dd></div>
    <div><dt>Average price per night</dt><dd>${n ? both(st / n) : '–'}${+x.custom > 0 ? ' <small>(custom price)</small>' : ''}</dd></div>
    <div><dt>Room total</dt><dd>${both(st)}</dd></div>
    ${charges(x) > 0 ? `<div><dt>Bar and restaurant</dt><dd>${money(charges(x))}</dd></div><div><dt>Total to pay</dt><dd>${both(tt)}</dd></div>` : ''}
    <div><dt>Paid</dt><dd>${money(x.paid)}</dd></div>
    <div><dt>Still to pay</dt><dd class="${bal > 0 ? 'owes' : ''}">${bal > 0 ? money(bal) : (x.paid > tt ? 'To refund to the guest: ' + money(x.paid - tt) : 'Paid in full')}</dd></div>
    ${x.notes ? `<div style="grid-column:1/-1"><dt>Special requests</dt><dd>${esc(x.notes)}</dd></div>` : ''}
  </dl>
  <div class="rd-side">${payBlock}${chargeBlock}</div>
  <div class="acts">${acts}</div>`, true);
  const f = document.querySelector('#dlgD .payf'); if (f) payHint(f);
}
function openRoom(id) {
  const r = roomOf(id), c = catOf(r), s = stayNow(id), t = today();
  const upcoming = S.res.filter((x) => x.roomId === id && x.status === 'confirmed' && x.arr >= t).sort((a, b) => a.arr.localeCompare(b.arr)).slice(0, 3);
  let body = '';
  if (s) {
    const g = guestOf(s.res.guestId);
    body += `<div class="lrow link" data-action="opres" data-id="${s.res.id}" style="margin:6px 28px 0">${med(g, 44)}<div class="who"><b>${esc(g.name)}</b><span>${s.kind === 'arr' ? 'Arriving today' : s.kind === 'dep' ? 'Leaving today' : 'In hotel'}, ${s.res.adults} ${plural(s.res.adults, 'person', 'people')}, ${fmtD(s.res.arr)} – ${fmtD(s.res.dep)}</span></div>${tierBadge(g)}</div>`;
  } else body += `<p class="none" style="margin:0 28px">${r.dirty ? 'The room is waiting to be cleaned.' : 'Free and ready for guests.'}</p>`;
  if (upcoming.length) body += `<div style="margin:16px 28px 0"><b style="font-family:var(--head);font-weight:400;font-size:17px">Upcoming reservations</b>${upcoming.map((x) => { const g = guestOf(x.guestId); return `<div class="stay" data-action="opres" data-id="${x.id}"><b>${esc(g.name)}</b><span>${fmtD(x.arr)} – ${fmtD(x.dep)}, ${x.adults} ${plural(x.adults, 'person', 'people')}</span></div>`; }).join('')}</div>`;
  const acts = `<button class="btn gold" data-action="newres" data-room="${r.id}" data-date="${t}">New reservation</button>` +
    (r.dirty ? `<button class="btn" data-action="clean" data-id="${r.id}">Mark as clean</button>` : (!s ? `<button class="btn" data-action="dirty" data-id="${r.id}">Mark for cleaning</button>` : ''));
  const from = unit(S, r.cat, t, c.inc);
  showDetails(`<div class="dh2"><div class="ttl"><div><h2>Room ${r.id}</h2><p>${esc(c.name)}, floor ${r.floor}, up to ${c.cap} people. ${c.extra > 0 ? 'From ' : ''}${money(from)} per night (≈ €${num(euro(from))})${c.extra > 0 ? ', plus ' + money(c.extra) + ' for each person above ' + c.inc : ''}.</p></div></div><button class="x" data-action="close" aria-label="Close">×</button></div>${body}<div class="acts" style="padding-top:22px">${acts}</div>`, false);
}

let FORM = { id: null };
function openForm(opt = {}) {
  const x = opt.id ? S.res.find((r) => r.id === opt.id) : null;
  FORM = { id: x ? x.id : null };
  $('gl').innerHTML = S.guests.map((g) => `<option value="${esc(g.name)}">`).join('');
  $('fRoom').innerHTML = S.rooms.map((r) => `<option value="${r.id}">${r.id}, ${esc(catOf(r).name)}</option>`).join('');
  $('fSrc').innerHTML = SOURCES.map((s) => `<option>${s}</option>`).join('');
  const g = x ? guestOf(x.guestId) : (opt.guestId ? guestOf(opt.guestId) : null);
  const arr = x ? x.arr : (opt.arr || today());
  $('fT').textContent = x ? 'Edit reservation' : 'New reservation';
  $('fGuest').value = g ? g.name : '';
  $('fPhone').value = g ? g.phone : '';
  $('fEmail').value = g ? g.email : '';
  $('fAd').value = x ? x.adults : 2;
  $('fRoom').value = x ? x.roomId : (opt.roomId || S.rooms[0].id);
  $('fSrc').value = x ? x.source : 'Direct';
  $('fArr').value = arr; $('fDep').value = x ? x.dep : addDays(arr, 1);
  $('fCustom').value = x && +x.custom > 0 ? x.custom : '';
  $('fPaid').value = x ? '' : 0; $('fPaid').closest('label').style.display = x ? 'none' : '';
  $('fNotes').value = x ? x.notes : '';
  $('fNotify').checked = !x;
  $('fNotifyRow').style.display = x ? 'none' : '';
  $('fErr').textContent = '';
  sumUpdate();
  if ($('dlgD').open) $('dlgD').close();
  if (!$('dlgF').open) $('dlgF').showModal();
  setTimeout(() => $('fGuest').focus(), 30);
}
function formQuote() {
  const room = roomOf($('fRoom').value);
  const x = { arr: $('fArr').value || today(), dep: $('fDep').value || today(), adults: +$('fAd').value || 1, custom: +$('fCustom').value || 0 };
  return { room, x, n: nightsOf(x), tot: totalWith(S, room.cat, x) };
}
function sumUpdate() {
  const { room, x, n, tot } = formQuote(), c = catOf(room), paid = FORM.id ? ((S.res.find((r) => r.id === FORM.id) || {}).paid || 0) : (+$('fPaid').value || 0);
  const extra = Math.max(0, x.adults - c.inc);
  const note = x.custom > 0 ? 'custom price' : (extra && c.extra ? `includes ${extra} extra ${plural(extra, 'person', 'people')}` : '');
  $('fSum').textContent = `${n} ${plural(n, 'night', 'nights')}, ${x.adults} ${plural(x.adults, 'person', 'people')}${note ? ' (' + note + ')' : ''}: ${money(tot)} (≈ €${num(euro(tot))}). Still to pay ${money(Math.max(0, tot - paid))}.`;
}
$('frm').addEventListener('input', (e) => {
  const id = e.target.id;
  if (id === 'fArr' && $('fArr').value && $('fDep').value <= $('fArr').value) $('fDep').value = addDays($('fArr').value, 1);
  if (id === 'fGuest') {
    const g = S.guests.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
    if (g && !$('fPhone').value) $('fPhone').value = g.phone;
    if (g && !$('fEmail').value) $('fEmail').value = g.email;
  }
  sumUpdate();
});
function openReq(guestId) {
  const inH = S.res.filter((x) => x.status === 'checkedin').map((x) => guestOf(x.guestId));
  const others = S.guests.filter((g) => !inH.includes(g));
  $('rGuest').innerHTML = `<optgroup label="In hotel">${inH.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</optgroup><optgroup label="Others">${others.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</optgroup>`;
  if (guestId) $('rGuest').value = guestId;
  $('rType').innerHTML = REQ_TYPES.map((t) => `<option>${t}</option>`).join('');
  $('rNote').value = ''; $('rErr').textContent = '';
  if (!$('dlgR').open) $('dlgR').showModal();
}

/* ---------- actions ---------- */
let tt;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 3600); }
function armed(btn) {
  if (btn.classList.contains('armed')) return true;
  const old = btn.textContent; btn.classList.add('armed'); btn.textContent = 'Confirm';
  setTimeout(() => { btn.classList.remove('armed'); btn.textContent = old; }, 3000); return false;
}

/** Runs a request against the server, refreshes the state and shows the message. Returns the result, or null if it failed. */
async function run(fn, msg) {
  try {
    const r = await fn();
    await refresh(); render();
    if (msg) toast(msg);
    return r;
  } catch (e) {
    toast(e.message);
    if (S) { try { await refresh(); render(); } catch (_e) { /* session expired */ } }
    return null;
  }
}
const reopen = (id) => { if ($('dlgD').open) openRes(id); };
const ALL_DIALOGS = ['dlgD', 'dlgF', 'dlgR', 'dlgP', 'dlgB', 'dlgM', 'dlgU'];

/** Switches to another section. Sections may register a leave hook (e.g. unsaved changes) and an ENTER loader. */
async function goto(view, { push = true, keep = false } = {}) {
  if (HOOKS.leave.some((h) => h(view) === false)) return false;
  UI.view = view;
  if (push) history.pushState({ view }, '', urlFor(view));
  render(); window.scrollTo(0, 0);
  if (ENTER[view]) await ENTER[view](keep);
  return true;
}
/* Back / Forward buttons of the browser */
window.addEventListener('popstate', async () => {
  if (!S) return;
  const prev = urlFor(UI.view);
  const view = readUrl();
  if (!(await goto(view, { push: false, keep: true }))) history.pushState({ view: UI.view }, '', prev);   // stayed (unsaved changes)
});

Object.assign(ACTIONS, {
  nav: (el) => goto(el.dataset.view),
  shift: (el) => { UI.start = addDays(UI.start, +el.dataset.n); render(); },
  todaynav: () => { UI.start = addDays(today(), -2); render(); },
  close: (el) => el.closest('dialog').close(),
  newres: (el) => openForm({ roomId: el.dataset.room, arr: el.dataset.date, guestId: el.dataset.guest }),
  opres: (el) => openRes(el.dataset.id),
  room: (el) => openRoom(el.dataset.id),
  edit: (el) => openForm({ id: el.dataset.id }),
  gopen: (el) => { if ($('dlgD').open) $('dlgD').close(); UI.gsel = el.dataset.id; UI.gq = ''; return goto('guests'); },
  gsel: (el) => { UI.gsel = el.dataset.id; $('gdet').innerHTML = gdetHTML(); document.querySelectorAll('.grow').forEach((b) => b.setAttribute('aria-current', b.dataset.id === el.dataset.id)); syncUrl(true); },
  async checkin(el) {
    const id = el.dataset.id, x = S.res.find((r) => r.id === id);
    const g = guestOf(x.guestId), tier = tierOf(g.points);
    const ok = await run(() => post(`/reservations/${id}/checkin`),
      `${g.name} checked in to room ${x.roomId}.${tier.c !== 't0' ? ' ' + tier.n + ': ' + tier.perk : ''}`);
    if (ok) reopen(id);
  },
  async checkout(el) {
    const id = el.dataset.id, x = S.res.find((r) => r.id === id);
    const before = tierOf(guestOf(x.guestId).points);
    const r = await run(() => post(`/reservations/${id}/checkout`));
    if (r) {
      const g2 = guestOf(x.guestId), after = tierOf(g2.points);
      let m = after !== before
        ? `${g2.name} moved up to ${after.n}. Room ${x.roomId} needs cleaning.`
        : `${g2.name} checked out and earned ${r.points} points. Room ${x.roomId} needs cleaning.${r.shortened ? ' The stay was shortened to today.' : ''}`;
      if (r.balance > 0) m += ` Unpaid balance: ${money(r.balance)}.`;
      toast(m);
      reopen(id);
    }
  },
  async cancel(el) { if (!armed(el)) return; if (await run(() => post(`/reservations/${el.dataset.id}/cancel`), 'The reservation was cancelled.')) $('dlgD').close(); },
  async restore(el) { if (await run(() => post(`/reservations/${el.dataset.id}/restore`), 'The reservation was restored.')) reopen(el.dataset.id); },
  async clean(el) { if (await run(() => post(`/rooms/${el.dataset.id}/clean`), `Room ${el.dataset.id} is ready.`)) $('dlgD').close(); },
  async dirty(el) { if (await run(() => post(`/rooms/${el.dataset.id}/dirty`))) $('dlgD').close(); },
  newreq: (el) => openReq(el.dataset.id),
  doreq: (el) => run(() => post(`/requests/${el.dataset.id}/done`), 'The request was marked as done.'),
  reqst: (el) => {
    const msg = { progress: 'Marked as in progress.', done: 'The request is done.', open: 'The request is open again.', cancelled: 'The request was cancelled.' }[el.dataset.st];
    return run(() => post(`/requests/${el.dataset.id}/status`, { status: el.dataset.st }), msg);
  },
  async prefadd() {
    const v = $('pref').value.trim(); if (!v) return;
    const g = guestOf(UI.gsel);
    await run(() => api(`/guests/${g.id}`, { method: 'PATCH', body: { prefs: [...g.prefs, v] } }));
  },
  async prefdel(el) {
    const g = guestOf(UI.gsel);
    await run(() => api(`/guests/${g.id}`, { method: 'PATCH', body: { prefs: g.prefs.filter((_, i) => i !== +el.dataset.i) } }));
  },
  chpass: () => { $('pCur').value = ''; $('pNew').value = ''; $('pErr').textContent = ''; $('dlgP').showModal(); },
  async logout() { try { await post('/auth/logout'); } catch (_e) { /* ignore */ } S = null; showLogin(); },
});

document.addEventListener('click', async (e) => {
  // close an open "More" menu when clicking anywhere else
  document.querySelectorAll('details.more[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
  const el = e.target.closest('[data-action]'); if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn && (S || el.dataset.action === 'login-role')) await fn(el, e);
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (!S) return;
  for (const h of HOOKS.change) if (await h(el, e)) return;
  if (el.closest && el.closest('.payf')) {
    const f = el.closest('.payf');
    if (el.name === 'cur') {   // switching currency: show the amount still owed in that currency
      const x = S.res.find((r) => r.id === f.dataset.id), bal = balance(x), rate = rateOf(el.value);
      f.amt.value = el.value === 'ALL' ? bal : (Math.round(bal / rate * 100) / 100).toFixed(2);
    }
    payHint(f); return;
  }
  if (el.id === 'jump' && el.value) { UI.start = el.value; render(); }
  else if (el.id === 'span') { UI.span = +el.value; render(); }
  else if (el.id === 'gnote') { const g = guestOf(UI.gsel); if (g) await run(() => api(`/guests/${g.id}`, { method: 'PATCH', body: { notes: el.value } }), 'The note was saved.'); }
});
document.addEventListener('input', (e) => {
  if (!S) return;
  for (const h of HOOKS.input) if (h(e.target, e)) return;
  if (e.target.name === 'amt' && e.target.closest('.payf')) { payHint(e.target.closest('.payf')); return; }
  if (e.target.id === 'gq') {
    UI.gq = e.target.value;
    const q = UI.gq.trim().toLowerCase();
    $('glist').innerHTML = glistHTML(S.guests.filter((g) => !q || `${g.name} ${g.phone}`.toLowerCase().includes(q)).sort((a, b) => b.points - a.points));
  }
});
document.addEventListener('keydown', async (e) => {
  if (!S) return;
  for (const h of HOOKS.keydown) if (await h(e.target, e)) return;
  if (e.key === 'Enter' && e.target.id === 'pref') {
    e.preventDefault();
    const v = e.target.value.trim(), g = guestOf(UI.gsel);
    if (v && g) await run(() => api(`/guests/${g.id}`, { method: 'PATCH', body: { prefs: [...g.prefs, v] } }));
  }
});

/* ---- forms ---- */
$('frm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    guestName: $('fGuest').value, phone: $('fPhone').value, email: $('fEmail').value, roomId: $('fRoom').value, arr: $('fArr').value, dep: $('fDep').value,
    adults: +$('fAd').value, source: $('fSrc').value, custom: +$('fCustom').value || 0, notes: $('fNotes').value,
  };
  if (!FORM.id) { body.deposit = +$('fPaid').value || 0; body.notifyGuest = $('fNotify').checked && !!body.email.trim(); }
  try {
    if (FORM.id) await api(`/reservations/${FORM.id}`, { method: 'PATCH', body });
    else await post('/reservations', body);
    await refresh();
    $('dlgF').close();
    if (body.arr < UI.start || body.arr >= addDays(UI.start, UI.span)) UI.start = addDays(body.arr, -2);
    render();
    const mailed = !FORM.id && S.mailEnabled ? ' The manager was notified by email.' : '';
    toast(FORM.id ? 'Changes saved.' : `Reservation for ${body.guestName.trim()} created.${mailed}`);
  } catch (err) { $('fErr').textContent = err.message; }
});
$('rfrm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await post('/requests', { guestId: $('rGuest').value, type: $('rType').value, note: $('rNote').value });
    await refresh(); $('dlgR').close(); render(); toast('The request was added to the concierge list.');
  } catch (err) { $('rErr').textContent = err.message; }
});
$('pform').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await post('/auth/password', { current: $('pCur').value, next: $('pNew').value });
    $('dlgP').close(); toast('Password changed.');
  } catch (err) { $('pErr').textContent = err.message; }
});
document.addEventListener('submit', async (e) => {
  const f = e.target;
  for (const h of HOOKS.submit) if (await h(f, e)) return;
  if (!f.classList || !f.classList.contains('payf')) return;
  e.preventDefault();
  const id = f.dataset.id, x = S.res.find((r) => r.id === id), cur = f.cur.value, rate = rateOf(cur);
  const v = parseAmount(f.amt.value, cur), bal = balance(x);
  const err = (m) => { $('payErr').textContent = m; f.amt.focus(); };
  // Check in the browser first and say exactly what is wrong (the server checks the same rules again).
  if (!(v > 0)) return err('Enter the amount the guest paid (a number greater than 0).');
  if (cur === 'ALL' && !Number.isInteger(v)) return err('Amounts in lek are whole numbers, without decimals.');
  if (cur !== 'ALL' && Math.round(v * 100) !== Math.round(v * 100 * 1e6) / 1e6) return err(`Use at most 2 decimals for ${cur}.`);
  const lek = cur === 'ALL' ? v : Math.round(v * rate);
  if (lek > bal + (cur === 'ALL' ? 0 : Math.ceil(rate / 100) + 1)) {
    return err(`That is more than what is still owed. Still to pay: ${money(bal)}${cur === 'ALL' ? '' : ' = ' + fmtCur(bal / rate, cur)}. You entered ${cur === 'ALL' ? money(v) : fmtCur(v, cur) + ' = ' + money(lek)}.`);
  }
  const btn = f.querySelector('[type=submit]'); btn.disabled = true;
  try {
    const r = await post(`/reservations/${id}/payments`, { amount: v, currency: cur, method: f.m.value });
    await refresh(); render(); reopen(id);
    toast(`Payment of ${money(r.amount)}${cur === 'ALL' ? '' : ' (' + fmtCur(v, cur) + ')'} recorded.${r.remaining > 0 ? ' Still to pay: ' + money(r.remaining) + '.' : ' Paid in full.'}`);
  } catch (e2) { btn.disabled = false; $('payErr').textContent = e2.message; }
});
ALL_DIALOGS.forEach((id) => { const d = $(id); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); });

/* ---- sign-in and start-up ---- */
let loginRole = 'receptionist';
function setLoginRole(role) {
  loginRole = role === 'manager' ? 'manager' : 'receptionist';
  $('roleManager').setAttribute('aria-checked', loginRole === 'manager');
  $('roleReceptionist').setAttribute('aria-checked', loginRole === 'receptionist');
  $('lBtn').textContent = `Sign in as ${loginRole === 'manager' ? 'Manager' : 'Receptionist'}`;
  try { localStorage.setItem(ROLE_KEY, loginRole); } catch (_e) { /* ignore */ }
}
ACTIONS['login-role'] = (el) => setLoginRole(el.dataset.v);

function showLogin() {
  ALL_DIALOGS.forEach((id) => { if ($(id).open) $(id).close(); });
  $('lPass').value = ''; $('lErr').textContent = '';
  let saved = null; try { saved = localStorage.getItem(ROLE_KEY); } catch (_e) { /* ignore */ }
  setLoginRole(saved);
  $('login').hidden = false;
  setTimeout(() => $('lEmail').focus(), 30);
}
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await post('/auth/login', { email: $('lEmail').value, password: $('lPass').value, role: loginRole });
    await boot();
  } catch (err) { $('lErr').textContent = err.message; }
});
async function boot() {
  try { await refresh(); } catch (_e) { showLogin(); return; }
  $('login').hidden = true;
  UI.view = readUrl();   // open the page that is in the address bar (a refresh stays where you were)
  render();
  if (ENTER[UI.view]) await ENTER[UI.view](true);
}
