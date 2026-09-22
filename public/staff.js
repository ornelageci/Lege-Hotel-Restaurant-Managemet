/* Staff & Email (manager only): user accounts, email notification status, and the recent activity log. */
UI.staff = { users: null, mail: null, activity: null, adding: false, resetId: null };

const ACTION_L = {
  'reservation.create': 'Created a reservation', 'reservation.update': 'Edited a reservation', 'reservation.checkin': 'Checked a guest in',
  'reservation.checkout': 'Checked a guest out', 'reservation.cancel': 'Cancelled a reservation', 'reservation.restore': 'Restored a reservation',
  'payment.add': 'Recorded a payment', 'room.clean': 'Marked a room as clean', 'room.dirty': 'Marked a room for cleaning',
  'price.set': 'Changed a price', 'category.update': 'Changed a room type', 'guest.update': 'Updated a guest', 'request.create': 'Added a concierge request', 'request.done': 'Completed a concierge request', 'settings.update': 'Changed settings', 'user.create': 'Created a user', 'user.update': 'Changed a user',
  'user.password_reset': 'Reset a password', 'user.delete': 'Deleted a user', 'order.create': 'Took a bar/restaurant order',
  'order.void': 'Voided an order', 'beach.assign': 'Assigned a beach umbrella', 'beach.release': 'Released a beach umbrella',
  'menu.create': 'Added a menu item', 'menu.update': 'Changed a menu item', 'menu.delete': 'Deleted a menu item',
};
const actionLabel = (a) => ACTION_L[a] || a.replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase());
const stamp = (iso) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

VIEWS.staff = function staffHTML() {
  const T = UI.staff;
  if (!isManager()) return `${head('Staff & Email', 'Managers only', '')}<p class="none">Only a manager can open this section.</p>`;
  if (!T.users || !T.mail) return `${head('Staff & Email', 'Accounts, notifications and activity', '')}<p class="none">Loading…</p>`;

  const rows = T.users.map((u) => {
    const me = u.id === S.me.id;
    return `<tr>
      <td><b>${esc(u.name)}</b>${me ? ' <span class="badge">You</span>' : ''}<br><small>${esc(u.email)}</small></td>
      <td><select data-user-role="${u.id}" aria-label="Role of ${esc(u.name)}"${me ? ' disabled title="You cannot change your own role"' : ''}>
        <option value="receptionist"${u.role === 'receptionist' ? ' selected' : ''}>Receptionist</option>
        <option value="manager"${u.role === 'manager' ? ' selected' : ''}>Manager</option></select></td>
      <td class="r"><button class="btn sm" data-action="user-reset" data-id="${u.id}">Reset password</button>
        ${me ? '' : `<button class="btn sm danger" data-action="user-delete" data-id="${u.id}">Delete</button>`}</td></tr>`;
  }).join('');

  const addForm = T.adding ? `<form class="addu" id="addUser" novalidate>
      <label class="f2">Full name<input id="nuName" autocomplete="off" maxlength="80"></label>
      <label class="f2">Email<input id="nuEmail" type="email" autocomplete="off"></label>
      <label class="f2">Role<select id="nuRole"><option value="receptionist">Receptionist</option><option value="manager">Manager</option></select></label>
      <label class="f2">Password (min. 10 characters)<input id="nuPass" type="password" autocomplete="new-password"></label>
      <div class="addu-b"><button class="btn gold" type="submit">Create account</button><button type="button" class="btn" data-action="user-add-cancel">Cancel</button></div>
      <p class="err" id="nuErr" role="alert"></p>
    </form>` : '';

  const M = T.mail;
  const STAT = { sent: 'Sent', failed: 'Failed', skipped: 'Not sent' };
  const log = M.log.length
    ? `<div class="tscroll"><table class="ptable"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead><tbody>${M.log.map((l) => `<tr><td>${stamp(l.at)}</td><td>${esc(l.recipient)}</td><td>${esc(l.subject)}</td><td><span class="mstat m-${esc(l.status)}"${l.error ? ` title="${esc(l.error)}"` : ''}>${STAT[l.status] || esc(l.status)}</span>${l.error ? `<br><small>${esc(l.error)}</small>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="none">No emails yet. One is sent for every new reservation.</p>';
  const mailBox = M.enabled
    ? `<p class="mailst on"><i></i><span>Email is on. Sending from <b>${esc(M.from)}</b>.</span></p>`
    : `<p class="mailst off"><i></i><span>Email is not set up yet. Reservations still work, but nobody is notified. Add <code>SMTP_HOST</code> and the other <code>SMTP_*</code> settings to the server's <code>.env</code> file, then restart. See the README.</span></p>`;

  const act = (T.activity || []).slice(0, 40).map((a) => `<div class="stay" style="cursor:default"><b>${esc(actionLabel(a.action))}</b><span>${esc(a.user || 'System')} · ${stamp(a.at)}</span></div>`).join('');

  return `${head('Staff & Email', 'Accounts, notifications and activity', '')}
  <section class="panel">
    <h2 class="sec">Notifications <small>new reservations</small></h2>
    ${mailBox}
    <p class="hint" style="text-align:left">Every new reservation is emailed to: ${M.recipients.length ? M.recipients.map((r) => `<b>${esc(r)}</b>`).join(', ') : '<b>nobody yet</b> (add a manager or set NOTIFY_EMAILS)'}. The email says who made the booking.</p>
    <div class="inl" style="max-width:420px"><button class="btn" data-action="mail-test"${M.enabled ? '' : ' disabled title="Set up email first"'}>Send a test email to me</button></div>
    <h3 class="sub">Recent emails</h3>
    ${log}
  </section>
  <section class="panel">
    <h2 class="sec">Accounts <small>${T.users.length} ${plural(T.users.length, 'person', 'people')}</small></h2>
    <div class="tscroll"><table class="ptable"><thead><tr><th>Person</th><th>Role</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    ${addForm}
    ${T.adding ? '' : '<div style="margin-top:14px"><button class="btn" data-action="user-add">Add a person</button></div>'}
    <p class="hint" style="text-align:left">Receptionists can manage reservations, bar and restaurant orders, and beach umbrellas. Managers can also change prices, the menu, staff accounts, and void orders.</p>
  </section>
  <section class="panel">
    <h2 class="sec">Recent activity</h2>
    ${act || '<p class="none">Nothing yet.</p>'}
  </section>`;
};

async function loadStaff() {
  const T = UI.staff;
  try {
    [T.users, T.mail, T.activity] = await Promise.all([api('/users'), api('/notifications'), api('/activity')]);
  } catch (e) { toast(e.message); }
  if (UI.view === 'staff') render();
}
ENTER.staff = async () => { if (!isManager()) return; UI.staff.users = null; UI.staff.mail = null; UI.staff.adding = false; render(); await loadStaff(); };

Object.assign(ACTIONS, {
  'user-add': () => { UI.staff.adding = true; render(); setTimeout(() => { const n = $('nuName'); if (n) n.focus(); }, 30); },
  'user-add-cancel': () => { UI.staff.adding = false; render(); },
  'user-reset': (el) => {
    const u = UI.staff.users.find((x) => x.id === el.dataset.id); if (!u) return;
    UI.staff.resetId = u.id;
    $('uT').textContent = `New password for ${u.name}`;
    $('uPass').value = ''; $('uErr').textContent = '';
    $('dlgU').showModal(); setTimeout(() => $('uPass').focus(), 30);
  },
  async 'user-delete'(el) {
    if (!armed(el)) return;
    try { await api(`/users/${el.dataset.id}`, { method: 'DELETE' }); toast('The account was deleted.'); await loadStaff(); }
    catch (e) { toast(e.message); }
  },
  async 'mail-test'(el) {
    el.disabled = true;
    try {
      const r = await post('/notifications/test');
      toast(r.status === 'sent' ? `A test email was sent to ${S.me.email}.` : r.status === 'failed' ? 'Sending failed. See the list below for the reason.' : 'Email is not set up yet.');
    } catch (e) { toast(e.message); }
    await loadStaff();
  },
});

HOOKS.change.push(async (el) => {
  if (!el.dataset || !el.dataset.userRole) return false;
  try { await api(`/users/${el.dataset.userRole}`, { method: 'PATCH', body: { role: el.value } }); toast('The role was changed. It applies the next time the person signs in.'); }
  catch (e) { toast(e.message); }
  await loadStaff();
  return true;
});

HOOKS.submit.push(async (f, e) => {
  if (f.id !== 'addUser') return false;
  e.preventDefault();
  try {
    await post('/users', { name: $('nuName').value, email: $('nuEmail').value, role: $('nuRole').value, password: $('nuPass').value });
    UI.staff.adding = false;
    toast('The account was created.');
    await loadStaff();
  } catch (err) { $('nuErr').textContent = err.message; }
  return true;
});

$('uform').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await post(`/users/${UI.staff.resetId}/password`, { password: $('uPass').value });
    $('dlgU').close(); toast('The password was changed.');
  } catch (err) { $('uErr').textContent = err.message; }
});
