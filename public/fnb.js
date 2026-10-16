/* Bar & Restaurant. Take an order from the menu and either charge it to the room of a guest who is checked in
 * (it is added to their bill and paid at check-out) or settle it on the spot with cash or card.
 * There is ONE order for both: the Bar / Restaurant tabs only switch which menu is shown, the order keeps everything.
 * The server stores the bar part and the restaurant part separately, so each keeps its own daily totals. */
const OUTLETS = { bar: 'Bar', restaurant: 'Restaurant' };
UI.fnb = { outlet: 'bar', cart: {}, dest: 'room', resId: '', method: 'cash', label: '', note: '', date: null, data: null, manage: false };
let MENU_EDIT = null;   // id of the menu item being edited, or null when adding

const inHouse = () => S.res.filter((x) => x.status === 'checkedin').sort((a, b) => a.roomId.localeCompare(b.roomId));
const menuOf = (outlet, includeHidden) => S.menu.filter((m) => m.outlet === outlet && (includeHidden || m.active));
const cartLines = () => {
  const F = UI.fnb;
  return Object.entries(F.cart).map(([id, qty]) => ({ m: S.menu.find((m) => m.id === id), qty })).filter((l) => l.m && l.m.active)
    .sort((a, b) => (a.m.outlet === b.m.outlet ? 0 : a.m.outlet === 'bar' ? -1 : 1));
};
const cartTotal = () => cartLines().reduce((s, l) => s + l.m.price * l.qty, 0);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

VIEWS.fnb = function fnbHTML() {
  const F = UI.fnb;
  if (!F.date) F.date = today();
  const items = menuOf(F.outlet, false);
  const sections = [...new Set(items.map((m) => m.section || 'Other'))];
  const guests = inHouse();
  if (F.dest === 'room' && !guests.some((x) => x.id === F.resId)) F.resId = guests.length ? guests[0].id : '';
  const lines = cartLines();
  const tot = cartTotal();
  const menuHTML = sections.length ? sections.map((sec) => `<h3 class="msec">${esc(sec)}</h3><div class="mgrid">${items.filter((m) => (m.section || 'Other') === sec).map((m) => {
    const q = F.cart[m.id] || 0;
    return `<button class="mi${q ? ' on' : ''}" data-action="fnb-add" data-id="${m.id}"><span>${esc(m.name)}</span><b>${num(m.price)}</b>${q ? `<em>${q}</em>` : ''}</button>`;
  }).join('')}</div>`).join('') : '<p class="none">The menu is empty.' + (isManager() ? ' Use “Manage menu” to add items.' : ' Ask a manager to add items.') + '</p>';
  const mixed = new Set(lines.map((l) => l.m.outlet)).size > 1;
  const cartHTML = lines.length ? lines.map((l) => `<div class="cl"><div class="cn">${esc(l.m.name)}<small>${money(l.m.price)}${mixed ? ' · ' + OUTLETS[l.m.outlet] : ''}</small></div>
      <div class="qty"><button data-action="fnb-dec" data-id="${l.m.id}" aria-label="Less">−</button><span>${l.qty}</span><button data-action="fnb-add" data-id="${l.m.id}" aria-label="More">+</button></div>
      <b class="lt">${num(l.m.price * l.qty)}</b><button class="rm" data-action="fnb-rm" data-id="${l.m.id}" aria-label="Remove ${esc(l.m.name)}">×</button></div>`).join('') : '<p class="none" style="padding:10px 0">Tap items on the menu to add them.</p>';
  const dest = `<div class="seg" role="radiogroup" aria-label="How is the order settled">
      <button type="button" data-action="fnb-dest" data-v="room" role="radio" aria-checked="${F.dest === 'room'}">Charge to room</button>
      <button type="button" data-action="fnb-dest" data-v="paid" role="radio" aria-checked="${F.dest === 'paid'}">Pay now</button></div>`;
  const destFields = F.dest === 'room'
    ? (guests.length ? `<label class="f">Guest in the hotel<select id="fnbRes">${guests.map((x) => `<option value="${x.id}"${x.id === F.resId ? ' selected' : ''}>Room ${x.roomId} · ${esc(guestOf(x.guestId).name)}</option>`).join('')}</select></label>` : '<p class="note">No guest is checked in, so nothing can be charged to a room. Choose “Pay now”.</p>')
    : `<div class="grid"><label class="f">Payment<select id="fnbMethod"><option value="cash"${F.method === 'cash' ? ' selected' : ''}>Cash</option><option value="card"${F.method === 'card' ? ' selected' : ''}>Card</option></select></label>
       <label class="f">Table or name (optional)<input id="fnbLabel" value="${esc(F.label)}" maxlength="60" placeholder="E.g. Terrace 4"></label></div>`;
  const canPlace = lines.length && (F.dest === 'paid' || F.resId);
  return `${head('Bar & Restaurant', 'Orders for the bar and the restaurant, charged to the room or paid on the spot',
    isManager() ? `<button class="btn" data-action="menu-manage">${F.manage ? 'Close menu editor' : 'Manage menu'}</button>` : '')}
  <div class="seg tabs" role="tablist" aria-label="Menu">${Object.entries(OUTLETS).map(([k, v]) => { const n = lines.filter((l) => l.m.outlet === k).reduce((a, l) => a + l.qty, 0); return `<button type="button" data-action="fnb-outlet" data-v="${k}" role="tab" aria-selected="${F.outlet === k}">${v}${n ? ` <em class="tabn">${n}</em>` : ''}</button>`; }).join('')}</div>
  ${F.manage ? menuEditorHTML() : ''}
  <div class="pos">
    <section aria-label="Menu">${menuHTML}</section>
    <aside class="ticket" id="ticket" aria-label="Current order">
      <h2 class="sec">New order <small>bar and restaurant together</small></h2>
      ${cartHTML}
      <div class="tot"><span>Total</span><b>${money(tot)}</b></div>
      ${dest}
      <div class="destf">${destFields}</div>
      <label class="f" style="margin-top:10px">Note (optional)<input id="fnbNote" value="${esc(F.note)}" maxlength="200" placeholder="E.g. no ice"></label>
      <button class="btn gold wide" data-action="fnb-place"${canPlace ? '' : ' disabled'}>${F.dest === 'room' ? 'Charge to room' : 'Record payment'}${tot ? ' · ' + money(tot) : ''}</button>
      ${lines.length ? '<button class="btn text" data-action="fnb-clear">Clear order</button>' : ''}
    </aside>
  </div>
  ${lines.length ? `<button class="cartbar" data-action="fnb-show-order"><span>${lines.reduce((a, l) => a + l.qty, 0)} items</span><b>View order · ${money(tot)}</b></button>` : ''}
  ${ordersHTML()}`;
};

function ordersHTML() {
  const F = UI.fnb, D = F.data;
  const nav = `<div class="tools" style="margin-top:34px"><h2 class="sec" style="flex:1;border:0;margin:0;padding:0">Orders of the day</h2>
      <button class="btn" data-action="fnb-day" data-n="-1" aria-label="Previous day">‹</button>
      <input type="date" id="fnbDate" value="${F.date}" aria-label="Day">
      <button class="btn" data-action="fnb-day" data-n="1" aria-label="Next day">›</button>
      <button class="btn" data-action="fnb-day" data-n="0">Today</button></div>`;
  if (!D) return `${nav}<p class="none">Loading orders…</p>`;
  const list = D.orders;
  const t = { room: 0, cash: 0, card: 0, count: 0, bar: 0, restaurant: 0 };
  list.forEach((o) => { if (o.status === 'void') return; t.count++; t[o.outlet] += o.total; if (o.status === 'room') t.room += o.total; else if (o.method === 'card') t.card += o.total; else t.cash += o.total; });
  const sum = `<div class="sumline" style="justify-content:flex-start;margin:6px 0 10px"><span><b>${num(t.bar)}</b>bar</span><span><b>${num(t.restaurant)}</b>restaurant</span><span><b>${num(t.room)}</b>charged to rooms</span><span><b>${num(t.cash)}</b>cash</span><span><b>${num(t.card)}</b>card</span><span><b>${num(t.room + t.cash + t.card)}</b>total lek</span></div>`;
  const rows = list.length ? list.map((o) => {
    const who = o.status === 'room' || o.reservationId ? `Room ${esc(o.roomId)} · ${esc(o.guestName)}` : (esc(o.label) || 'Walk-in');
    const badge = `<span class="badge">${OUTLETS[o.outlet]}</span> ` + (o.status === 'void' ? '<span class="badge s-cancelled">Voided</span>' : o.status === 'room' ? '<span class="badge s-confirmed">Room</span>' : `<span class="badge">${o.method === 'card' ? 'Card' : 'Cash'}</span>`);
    return `<div class="lrow${o.status === 'void' ? ' void' : ''}"><div class="who"><b>${who} ${badge}</b><span>${o.items.map((i) => `${i.qty}× ${esc(i.name)}`).join(', ')}${o.note ? ' · ' + esc(o.note) : ''}</span><span>${fmtTime(o.at)}${o.staff ? ' · ' + esc(o.staff) : ''}${o.reservationId && o.label && !/^Room /.test(o.label) ? ' · ' + esc(o.label) : ''}</span></div>
      <b class="amt">${money(o.total)}</b>${isManager() && o.status !== 'void' ? `<button class="btn sm danger" data-action="fnb-void" data-id="${o.id}">Void</button>` : ''}</div>`;
  }).join('') : '<p class="none">No orders on this day.</p>';
  return `${nav}${sum}${rows}`;
}

function menuEditorHTML() {
  const F = UI.fnb;
  const items = menuOf(F.outlet, true);
  return `<section class="menued"><h2 class="sec">Manage ${OUTLETS[F.outlet].toLowerCase()} menu <small><button class="btn sm gold" data-action="menu-add">Add item</button></small></h2>
    <div class="tw"><table class="ptable"><thead><tr><th>Section</th><th>Item</th><th>Price (lek)</th><th>Status</th><th></th></tr></thead><tbody>${items.map((m) => `<tr class="${m.active ? '' : 'off'}">
      <td>${esc(m.section)}</td><td>${esc(m.name)}</td><td>${num(m.price)}</td><td>${m.active ? 'Available' : 'Hidden'}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-action="menu-edit" data-id="${m.id}">Edit</button> <button class="btn sm" data-action="menu-toggle" data-id="${m.id}">${m.active ? 'Hide' : 'Show'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="none">No items yet.</td></tr>'}</tbody></table></div>
    <p class="note">Changes to a price only affect new orders. Orders already taken keep the price they were made at.</p></section>`;
}

async function loadOrders() {
  const F = UI.fnb;
  try { F.data = await api(`/orders?date=${F.date}`); } catch (e) { F.data = { orders: [], totals: {} }; toast(e.message); }
  if (UI.view === 'fnb') render();
}
ENTER.fnb = async (keep) => { if (!keep || !UI.fnb.date) UI.fnb.date = today(); UI.fnb.data = null; render(); await loadOrders(); };

const fnbBump = (id, d) => {
  const F = UI.fnb, q = Math.max(0, Math.min(50, (F.cart[id] || 0) + d));
  if (q) F.cart[id] = q; else delete F.cart[id];
  render();
};
Object.assign(ACTIONS, {
  'fnb-outlet': (el) => { UI.fnb.outlet = el.dataset.v; render(); },   // only the menu changes; the order is kept
  'fnb-add': (el) => fnbBump(el.dataset.id, 1),
  'fnb-dec': (el) => fnbBump(el.dataset.id, -1),
  'fnb-rm': (el) => { delete UI.fnb.cart[el.dataset.id]; render(); },
  'fnb-show-order': () => $('ticket').scrollIntoView({ behavior: 'smooth', block: 'start' }),
  'fnb-clear': () => { UI.fnb.cart = {}; UI.fnb.note = ''; render(); },
  'fnb-dest': (el) => { UI.fnb.dest = el.dataset.v; render(); },
  'fnb-day': async (el) => { const n = +el.dataset.n; UI.fnb.date = n === 0 ? today() : addDays(UI.fnb.date, n); UI.fnb.data = null; render(); await loadOrders(); },
  'fnb-for': async (el) => {   // from a reservation: charge the next order to this guest
    if ($('dlgD').open) $('dlgD').close();
    Object.assign(UI.fnb, { dest: 'room', resId: el.dataset.id });
    await goto('fnb');
    UI.fnb.resId = el.dataset.id; render();
  },
  async 'fnb-place'() {
    const F = UI.fnb, lines = cartLines(); if (!lines.length) return;
    const body = { destination: F.dest, note: F.note, items: lines.map((l) => ({ id: l.m.id, qty: l.qty })) };   // no outlet: bar and restaurant together
    if (F.dest === 'room') body.reservationId = F.resId; else { body.method = F.method; body.label = F.label; }
    const guestName = F.dest === 'room' && S.res.find((x) => x.id === F.resId) ? guestOf(S.res.find((x) => x.id === F.resId).guestId).name : '';
    const roomNo = F.dest === 'room' ? (S.res.find((x) => x.id === F.resId) || {}).roomId : '';
    const r = await run(async () => { const o = await post('/orders', body); F.date = today(); F.data = await api(`/orders?date=${F.date}`); return o; });
    if (r) {
      Object.assign(F, { cart: {}, note: '', label: '' });
      render();
      toast(F.dest === 'room' ? `${money(r.total)} charged to room ${roomNo} (${guestName}).` : `${money(r.total)} recorded as ${F.method === 'card' ? 'card' : 'cash'} payment.`);
    }
  },
  async 'fnb-void'(el) {
    if (!armed(el)) return;
    await run(async () => { await post(`/orders/${el.dataset.id}/void`); UI.fnb.data = await api(`/orders?date=${UI.fnb.date}`); }, 'The order was voided.');
  },
  'menu-manage': () => { UI.fnb.manage = !UI.fnb.manage; render(); },
  'menu-add': () => openMenuForm(null),
  'menu-edit': (el) => openMenuForm(el.dataset.id),
  async 'menu-toggle'(el) { const m = S.menu.find((x) => x.id === el.dataset.id); await run(() => api(`/menu/${m.id}`, { method: 'PATCH', body: { active: !m.active } }), m.active ? `“${m.name}” is hidden.` : `“${m.name}” is available again.`); },
  async 'menu-delete'(el) {
    if (!armed(el)) return;
    if (await run(() => api(`/menu/${MENU_EDIT}`, { method: 'DELETE' }), 'The item was deleted.')) $('dlgM').close();
  },
});

function openMenuForm(id) {
  const F = UI.fnb, m = id ? S.menu.find((x) => x.id === id) : null;
  MENU_EDIT = id;
  $('mT').textContent = m ? 'Edit menu item' : `New ${OUTLETS[F.outlet].toLowerCase()} item`;
  $('msl').innerHTML = [...new Set(menuOf(F.outlet, true).map((x) => x.section).filter(Boolean))].map((s) => `<option value="${esc(s)}">`).join('');
  $('mSection').value = m ? m.section : ''; $('mName').value = m ? m.name : ''; $('mPrice').value = m ? m.price : '';
  $('mActive').checked = m ? m.active : true;
  $('mDel').style.display = m ? '' : 'none';
  $('mErr').textContent = '';
  $('dlgM').showModal(); setTimeout(() => $('mName').focus(), 30);
}
HOOKS.submit.push(async (f, e) => {
  if (f.id !== 'mfrm') return false;
  e.preventDefault();
  const body = { section: $('mSection').value, name: $('mName').value, price: +$('mPrice').value, active: $('mActive').checked };
  try {
    if (MENU_EDIT) await api(`/menu/${MENU_EDIT}`, { method: 'PATCH', body });
    else await post('/menu', { ...body, outlet: UI.fnb.outlet });
    await refresh(); $('dlgM').close(); render(); toast('The menu was updated.');
  } catch (err) { $('mErr').textContent = err.message; }
  return true;
});

/* keep the ticket fields in the state so they survive re-renders */
HOOKS.change.push(async (el) => {
  const F = UI.fnb;
  if (el.id === 'fnbRes') { F.resId = el.value; return true; }
  if (el.id === 'fnbMethod') { F.method = el.value; return true; }
  if (el.id === 'fnbDate') { if (el.value) { F.date = el.value; F.data = null; render(); await loadOrders(); } return true; }
  return false;
});
HOOKS.input.push((el) => {
  const F = UI.fnb;
  if (el.id === 'fnbLabel') { F.label = el.value; return true; }
  if (el.id === 'fnbNote') { F.note = el.value; return true; }
  return false;
});
