/* Prices. Nothing is saved while you type: every change stays in the form until you press "Save changes",
 * which sends the exchange rate, the categories and the prices to the server in one request (all or nothing). */
const MON_CAP = MON_LONG;

VIEWS.prices = function pricesHTML() {
  const ro = isManager() ? '' : ' disabled';
  const cm = new Date().getMonth();
  const catKeys = Object.keys(S.cats);
  const cnt = (k) => S.rooms.filter((r) => r.cat === k).length;
  const catRows = catKeys.map((k) => {
    const c = S.cats[k];
    return `<tr>
    <td><input${ro} data-cf="name" data-cat="${k}" value="${esc(c.name)}" aria-label="Category name" style="min-width:130px"></td>
    <td class="eu">${cnt(k)}</td>
    <td><input${ro} type="number" min="1" data-cf="cap" data-cat="${k}" value="${c.cap}" aria-label="Maximum people"></td>
    <td><input${ro} type="number" min="1" data-cf="inc" data-cat="${k}" value="${c.inc}" aria-label="People included"></td>
    <td><input${ro} type="number" min="0" step="100" data-cf="extra" data-cat="${k}" value="${c.extra}" aria-label="Price per extra person"></td></tr>`;
  }).join('');
  const defRow = `<tr><td>Base price</td>${catKeys.map((k) => `<td><input${ro} type="number" min="0" step="100" data-cat="${k}" data-m="def" value="${S.prices[k].def}" aria-label="Base price ${esc(S.cats[k].name)}"></td><td class="eu">≈ €${num(euro(S.prices[k].def))}</td>`).join('')}</tr>`;
  const monRows = MON_CAP.map((mn, i) => `<tr class="${i === cm ? 'cur' : ''}"><td>${mn}</td>${catKeys.map((k) => {
    const v = S.prices[k].m[i]; const has = v !== undefined && v !== null && v !== ''; const eff = has ? +v : +S.prices[k].def;
    return `<td><input${ro} type="number" min="0" step="100" data-cat="${k}" data-m="${i}" value="${has ? v : ''}" placeholder="${num(S.prices[k].def)}" aria-label="${mn}, ${esc(S.cats[k].name)}"></td><td class="eu">≈ €${num(euro(eff))}</td>`;
  }).join('')}</tr>`).join('');
  const bar = ro ? '' : `<div class="savebar" id="savebar" role="region" aria-label="Save prices">
      <span id="saveMsg">No changes yet</span>
      <span class="err" id="saveErr" role="alert"></span>
      <span class="sp"></span>
      <button class="btn" data-action="prices-discard" id="btnDiscard" disabled>Discard changes</button>
      <button class="btn gold" data-action="prices-save" id="btnSave" disabled>Save changes</button>
    </div>`;
  return `${head('Prices', 'Prices per night by category and month', '')}
  ${ro ? '<p class="note" style="margin:-10px 0 20px">Only a manager can change prices.</p>' : '<p class="note" style="margin:-10px 0 20px">Edit as much as you like, then press <b>Save changes</b>. Nothing is saved until you do.</p>'}
  <form id="pricesForm" class="two">
    <section>
      <h2 class="sec">Exchange rate</h2>
      <label class="f2">Lek per 1 euro<input${ro} id="fx" type="number" step="0.1" min="1" value="${S.fx}"></label>
      <p class="note" style="margin-top:8px" id="fxNote">7,500 lek ≈ €${num(7500 / S.fx)} at this rate. Euro is shown only as a guide.</p>
      <h2 class="sec gap">Room categories</h2>
      <div class="tw"><table class="ptable"><thead><tr><th>Name</th><th>Rooms</th><th>Max. people</th><th>Included</th><th>Extra person (lek/night)</th></tr></thead><tbody>${catRows}</tbody></table></div>
      <p class="note" style="margin-top:10px" id="priceExample"></p>
    </section>
    <section>
      <h2 class="sec">Price per night <small>leave a month empty to use the base price</small></h2>
      <div class="tw"><table class="ptable"><thead><tr><th></th>${catKeys.map((k) => `<th colspan="2">${esc(S.cats[k].name)}</th>`).join('')}</tr></thead><tbody>${defRow}${monRows}</tbody></table></div>
      <p class="note" style="margin-top:10px">The price applies by the date of each night. A stay that crosses into another month is priced night by night.</p>
    </section>
  </form>
  ${bar}`;
};

AFTER.prices = () => updatePriceLive();

/** Compares the form with the saved state and returns what changed. */
function pricingChanges() {
  const body = { categories: {}, prices: [] };
  let count = 0;
  const fxEl = $('fx');
  if (fxEl && fxEl.value !== '' && +fxEl.value !== S.fx) { body.fx = +fxEl.value; count++; }
  else if (fxEl && fxEl.value === '') { body.fx = 0; count++; }   // empty is invalid: let the server explain
  document.querySelectorAll('#pricesForm [data-cf]').forEach((el) => {
    const cat = el.dataset.cat, f = el.dataset.cf;
    const v = f === 'name' ? el.value : +el.value;
    if (v !== S.cats[cat][f]) { (body.categories[cat] ||= {})[f] = v; count++; }
  });
  document.querySelectorAll('#pricesForm [data-m]').forEach((el) => {
    const cat = el.dataset.cat, m = el.dataset.m;
    const raw = m === 'def' ? S.prices[cat].def : S.prices[cat].m[+m];
    const cur = raw === undefined || raw === null || raw === '' ? null : +raw;
    const nv = el.value === '' ? null : +el.value;
    if (cur !== nv) { body.prices.push({ cat, month: m === 'def' ? 'def' : +m, amount: nv }); count++; }
  });
  return { body, count };
}
const pricesDirty = () => UI.view === 'prices' && !!$('pricesForm') && isManager() && pricingChanges().count > 0;

/** Live feedback while typing: euro amounts, the example sentence and the Save bar. Nothing is sent to the server. */
function updatePriceLive() {
  const form = $('pricesForm'); if (!form) return;
  const fx = +$('fx').value > 0 ? +$('fx').value : S.fx;
  const eur = (v) => `≈ €${num((+v || 0) / fx)}`;
  const defOf = (cat) => +(form.querySelector(`[data-cat="${cat}"][data-m="def"]`).value || 0);
  form.querySelectorAll('[data-m]').forEach((el) => {
    const eff = el.value === '' ? defOf(el.dataset.cat) : +el.value;
    if (el.dataset.m !== 'def') el.placeholder = num(defOf(el.dataset.cat));
    const eu = el.closest('td').nextElementSibling; if (eu) eu.textContent = eur(eff);
  });
  $('fxNote').textContent = `7,500 lek ≈ €${num(7500 / fx)} at this rate. Euro is shown only as a guide.`;
  const k = Object.keys(S.cats).find((x) => S.cats[x].cap > S.cats[x].inc) || Object.keys(S.cats)[0];
  const val = (f) => form.querySelector(`[data-cf="${f}"][data-cat="${k}"]`).value;
  const mv = form.querySelector(`[data-cat="${k}"][data-m="${new Date().getMonth()}"]`);
  const base = mv && mv.value !== '' ? +mv.value : defOf(k);
  const inc = +val('inc') || 1, extra = +val('extra') || 0, people = Math.min(6, +val('cap') || 6);
  $('priceExample').textContent = `Example: ${val('name')} with ${people} people this month costs ${money(base + Math.max(0, people - inc) * extra)} per night (${money(base)} + ${Math.max(0, people - inc)} × ${money(extra)}).`;
  const bar = $('savebar'); if (!bar) return;
  const { count } = pricingChanges();
  $('saveMsg').textContent = count ? `${count} unsaved ${plural(count, 'change', 'changes')}` : 'No changes yet';
  $('btnSave').disabled = !count; $('btnDiscard').disabled = !count;
  bar.classList.toggle('dirty', count > 0);
  if (!count) $('saveErr').textContent = '';
}

HOOKS.input.push((el) => {
  if (UI.view === 'prices' && el.closest && el.closest('#pricesForm')) { updatePriceLive(); return true; }
  return false;
});
HOOKS.change.push((el) => !!(UI.view === 'prices' && el.closest && el.closest('#pricesForm')));   // typing never saves by itself
HOOKS.submit.push((f, e) => { if (f.id === 'pricesForm') { e.preventDefault(); return true; } return false; });   // Enter never submits
HOOKS.leave.push((next) => {
  if (UI.view === 'prices' && next !== 'prices' && pricesDirty()) return confirm('You have unsaved price changes. Leave without saving?');
  return true;
});
window.addEventListener('beforeunload', (e) => { if (S && pricesDirty()) { e.preventDefault(); e.returnValue = ''; } });

ACTIONS['prices-discard'] = () => { render(); toast('Changes discarded.'); };
ACTIONS['prices-save'] = async () => {
  const { body, count } = pricingChanges();
  if (!count) return;
  $('btnSave').disabled = true; $('saveErr').textContent = '';
  try {
    await api('/pricing', { method: 'PUT', body });
    await refresh(); render();
    toast(`Saved ${count} ${plural(count, 'change', 'changes')}.`);
  } catch (err) {
    $('saveErr').textContent = err.message;   // your edits stay in the form so you can correct them
    $('btnSave').disabled = false;
    toast(err.message);
  }
};
