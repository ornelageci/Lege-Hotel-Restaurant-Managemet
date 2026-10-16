/* Beach umbrellas. Every umbrella is numbered 1..N (39 by default). For any day you can see which ones are free and which are taken,
 * and by whom: the room number for hotel guests, or first and last name for other guests. */
UI.beach = { date: null, data: null, who: 'guest' };

/* An umbrella seen from above: a round canopy with ribs, like on a map. */
const PARASOL = '<svg class="pz" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18"/><path d="M20 2v36M2 20h36M7.3 7.3l25.4 25.4M32.7 7.3L7.3 32.7"/><circle class="hub" cx="20" cy="20" r="9.5"/></svg>';

VIEWS.beach = function beachHTML() {
  const B = UI.beach;
  if (!B.date) B.date = today();
  const D = B.data;
  const right = `<button class="btn gold" data-action="beach-new">Assign umbrella</button>`;
  const nav = `<div class="tools">
      <button class="btn" data-action="beach-day" data-n="-1" aria-label="Previous day">‹</button>
      <button class="btn" data-action="beach-day" data-n="0">Today</button>
      <button class="btn" data-action="beach-day" data-n="1" aria-label="Next day">›</button>
      <span class="rng">${fmtLong(B.date)}</span>
      <input type="date" id="beachDate" value="${B.date}" aria-label="Day">
    </div>`;
  if (!D) return `${head('Beach', 'Umbrellas by day', right)}${nav}<p class="none">Loading…</p>`;
  const hotel = D.spots.filter((s) => s.booking && s.booking.reservationId).length;
  const walk = D.taken - hotel;
  const perRow = D.perRow || 10;
  const tile = (s) => {
    const b = s.booking;
    if (!b) return `<button class="umb free" data-action="beach-spot" data-spot="${s.spot}" aria-label="Umbrella ${s.spot}, row ${s.row}, free" title="Umbrella ${s.spot} · free">${PARASOL}<b>${s.spot}</b><span class="lb">Free</span></button>`;
    const kind = b.reservationId ? 'hotel' : 'walk';
    const sub = b.roomId ? `Room ${esc(b.roomId)}` : (b.reservationId ? 'Hotel guest' : 'Beach guest');
    const short = esc(b.guestName.split(/\s+/).map((w, i) => (i ? w[0] + '.' : w)).join(' '));
    return `<button class="umb ${kind}" data-action="beach-spot" data-spot="${s.spot}" aria-label="Umbrella ${s.spot}, row ${s.row}, taken by ${esc(b.guestName)}, ${sub}" title="${esc(b.guestName)} · ${sub}">${PARASOL}<b>${s.spot}</b><span class="lb">${b.roomId ? `<i class="lbx">Room </i>${esc(b.roomId)}` : short}</span></button>`;
  };
  // The beach as a map: the water on top, row 1 (front row) right at the shore, then the rows behind it.
  const rows = [];
  for (let r = 1; r <= Math.ceil(D.total / perRow); r++) rows.push(D.spots.filter((s) => Math.ceil(s.spot / perRow) === r));
  const rowsHTML = rows.map((list, i) => {
    const free = list.filter((s) => !s.booking).length;
    return `<div class="brow"><div class="rlab"><b>Row ${i + 1}</b><span>${i === 0 ? 'front row · ' : ''}${free} free</span></div><div class="rspots" style="--n:${perRow}">${list.map(tile).join('')}</div></div>`;
  }).join('');
  const map = `<div class="bmap"><div class="water" aria-hidden="true"><span>River</span></div><div class="shore" aria-hidden="true"></div>
    <div class="sand">${rowsHTML}</div><div class="bpath" aria-hidden="true"><span>Path to the hotel &amp; beach bar</span></div></div>`;
  const total = isManager() ? `<div class="inl beachset"><label class="f2">Umbrellas on the beach<input id="beachTotal" type="number" min="1" max="500" value="${D.total}"></label><label class="f2">Umbrellas per row<input id="beachPerRow" type="number" min="1" max="60" value="${perRow}"></label><button class="btn sm" data-action="beach-total">Save layout</button></div>` : '';
  return `${head('Beach', `${D.total} umbrellas · ${fmtLong(B.date)}`, right)}
  ${nav}
  <div class="sumline" style="justify-content:flex-start;margin:4px 0 18px"><span><b>${D.free}</b>free</span><span><b>${D.taken}</b>taken</span><span><b>${hotel}</b>hotel ${plural(hotel, 'guest', 'guests')}</span><span><b>${walk}</b>other ${plural(walk, 'guest', 'guests')}</span></div>
  <div class="bwrap">${map}</div>
  <div class="legend"><span><i class="u-free"></i>Free</span><span><i class="u-hotel"></i>Hotel guest (room number)</span><span><i class="u-walk"></i>Other guest (name)</span></div>
  <p class="hint" style="text-align:center">Click a free umbrella to assign it, or a taken one to see the details or release it.</p>
  ${total}`;
};

async function loadBeach() {
  const B = UI.beach;
  try { B.data = await api(`/beach?date=${B.date}`); } catch (e) { toast(e.message); B.data = null; }
  if (UI.view === 'beach') render();
}
ENTER.beach = async (keep) => { if (!keep || !UI.beach.date) UI.beach.date = today(); UI.beach.data = null; render(); await loadBeach(); };

/* ---------- assign dialog ---------- */
function beachCandidates(from, to) {
  if (!from) return [];
  const end = to || from;
  return S.res.filter((x) => (x.status === 'confirmed' || x.status === 'checkedin') && x.arr <= end && x.dep >= from)
    .sort((a, b) => a.roomId.localeCompare(b.roomId));
}
function fillBeachGuests(keep) {
  const list = beachCandidates($('bFrom').value, $('bTo').value);
  $('bRes').innerHTML = list.length
    ? list.map((x) => `<option value="${x.id}">Room ${x.roomId} · ${esc(guestOf(x.guestId).name)} (${fmtD(x.arr)} – ${fmtD(x.dep)})</option>`).join('')
    : '<option value="">No hotel guest is staying on these dates</option>';
  if (keep && list.some((x) => x.id === keep)) $('bRes').value = keep;
  $('bWhoGuest').disabled = false;
  updateBeachWho();
}
function setBeachWho(who) { UI.beach.who = who; updateBeachWho(); }
function updateBeachWho() {
  const who = UI.beach.who;
  $('bWhoGuest').setAttribute('aria-checked', who === 'guest');
  $('bWhoOther').setAttribute('aria-checked', who === 'other');
  $('bResRow').style.display = who === 'guest' ? '' : 'none';
  $('bNameRow').style.display = who === 'other' ? '' : 'none';
  $('bWhole').style.display = who === 'guest' ? '' : 'none';
  const none = who === 'guest' && !$('bRes').value;
  $('bHint').textContent = who === 'guest'
    ? (none ? 'Nobody is staying in the hotel on these dates. Use “Other guest” and type a first and last name.' : 'The room number is shown on the umbrella. The dates must fall within the stay.')
    : 'Type the first and last name. This is for people who are not staying in the hotel.';
}
function openBeachForm({ spot, resId } = {}) {
  const B = UI.beach, D = B.data;
  if ($('dlgD').open) $('dlgD').close();
  const total = D ? D.total : 39;
  const taken = new Map((D ? D.spots : []).filter((s) => s.booking).map((s) => [s.spot, s.booking]));
  const first = spot || ((D ? D.spots.find((s) => !s.booking) : null) || { spot: 1 }).spot;
  const per = (D && D.perRow) || 10;
  $('bSpot').innerHTML = Array.from({ length: total }, (_, i) => i + 1).map((n) => `<option value="${n}">Umbrella ${n} · row ${Math.ceil(n / per)}${taken.has(n) ? ' (taken on ' + fmtD(B.date) + ')' : ''}</option>`).join('');
  $('bSpot').value = first;
  const r = resId ? S.res.find((x) => x.id === resId) : null;
  let from = B.date || today();
  if (r) { if (from < r.arr) from = r.arr; if (from > r.dep) from = r.dep; }
  $('bFrom').value = from; $('bTo').value = from;
  $('bName').value = ''; $('bNote').value = ''; $('bErr').textContent = '';
  B.who = r || beachCandidates(from, from).length ? 'guest' : 'other';
  fillBeachGuests(r ? r.id : null);
  if (r) $('bRes').value = r.id;
  updateBeachWho();
  $('dlgB').showModal();
  setTimeout(() => (B.who === 'other' ? $('bName') : $('bRes')).focus(), 30);
}

function openBeachDetails(spot) {
  const s = UI.beach.data.spots.find((x) => x.spot === spot), b = s && s.booking; if (!b) return;
  showDetails(`<div class="dh2"><div class="ttl"><div><h2>Umbrella ${b.spot}</h2><p>Taken by ${esc(b.guestName)}</p></div></div><button class="x" data-action="close" aria-label="Close">×</button></div>
  <dl class="facts">
    <div><dt>Guest</dt><dd>${esc(b.guestName)}</dd></div>
    <div><dt>Room</dt><dd>${b.roomId ? esc(b.roomId) : 'Not a hotel guest'}</dd></div>
    <div><dt>Place</dt><dd>Row ${s.row}${s.row === 1 ? ' (front row)' : ''}, position ${s.pos}</dd></div>
    <div><dt>From</dt><dd>${fmtLong(b.from)}</dd></div><div><dt>To (included)</dt><dd>${fmtLong(b.to)}</dd></div>
    <div><dt>Assigned by</dt><dd>${esc(b.createdBy || '–')}</dd></div>
    ${b.notes ? `<div><dt>Note</dt><dd>${esc(b.notes)}</dd></div>` : ''}
  </dl>
  <div class="acts">${b.reservationId ? `<button class="btn" data-action="opres" data-id="${b.reservationId}">Open reservation</button>` : ''}<button class="btn danger grow2" data-action="beach-release" data-id="${b.id}">Release umbrella</button></div>`, false);
}

Object.assign(ACTIONS, {
  'beach-day': async (el) => { const n = +el.dataset.n; UI.beach.date = n === 0 ? today() : addDays(UI.beach.date, n); UI.beach.data = null; render(); await loadBeach(); },
  'beach-new': () => openBeachForm({}),
  'beach-spot': (el) => {
    const spot = +el.dataset.spot, s = UI.beach.data.spots.find((x) => x.spot === spot);
    if (s && s.booking) openBeachDetails(spot); else openBeachForm({ spot });
  },
  'beach-who': (el) => { setBeachWho(el.dataset.v); },
  'beach-wholestay': () => {
    const x = S.res.find((r) => r.id === $('bRes').value); if (!x) return;
    $('bFrom').value = x.arr; $('bTo').value = x.dep > x.arr ? addDays(x.dep, -1) : x.arr;
  },
  'beach-for': async (el) => {   // from a reservation
    if ($('dlgD').open) $('dlgD').close();
    await goto('beach');
    openBeachForm({ resId: el.dataset.id });
  },
  async 'beach-release'(el) {
    if (!armed(el)) return;
    const spot = document.querySelector('#dlgD h2').textContent;
    await run(async () => { await api(`/beach/bookings/${el.dataset.id}`, { method: 'DELETE' }); await loadBeach(); }, `${spot} is free again.`);
    $('dlgD').close();
  },
  async 'beach-total'() {
    const v = +$('beachTotal').value, pr = +$('beachPerRow').value;
    await run(async () => { await api('/settings', { method: 'PUT', body: { beachUmbrellas: v, beachPerRow: pr } }); await loadBeach(); }, `The beach now has ${v} umbrellas, ${pr} per row.`);
  },
});

HOOKS.change.push(async (el) => {
  if (el.id === 'beachDate') { if (el.value) { UI.beach.date = el.value; UI.beach.data = null; render(); await loadBeach(); } return true; }
  if (el.id === 'bFrom' || el.id === 'bTo') {
    if (el.id === 'bFrom' && $('bTo').value < $('bFrom').value) $('bTo').value = $('bFrom').value;
    fillBeachGuests($('bRes').value);
    return true;
  }
  return false;
});
HOOKS.submit.push(async (f, e) => {
  if (f.id !== 'bfrm') return false;
  e.preventDefault();
  const B = UI.beach;
  const body = { spot: +$('bSpot').value, from: $('bFrom').value, to: $('bTo').value || $('bFrom').value, notes: $('bNote').value };
  if (B.who === 'guest') { if (!$('bRes').value) { $('bErr').textContent = 'Choose a hotel guest, or switch to “Other guest”.'; return true; } body.reservationId = $('bRes').value; }
  else body.guestName = $('bName').value;
  try {
    await post('/beach/bookings', body);
    const who = B.who === 'guest' ? guestOf(S.res.find((x) => x.id === body.reservationId).guestId).name : body.guestName.trim();
    if (B.date < body.from || B.date > body.to) B.date = body.from;
    $('dlgB').close();
    B.data = null; render(); await loadBeach();
    toast(`Umbrella ${body.spot} assigned to ${who}.`);
  } catch (err) { $('bErr').textContent = err.message; }
  return true;
});
