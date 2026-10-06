'use strict';
/* global state, h, $, api, mount, add, fill, toast, fail, route, askConfirm, fmtDate, fmtWhen */
/**
 * Bazaario Admin portal (admin.html): email and password sign-in (plus the optional code), the left menu, staff and roles,
 * My account, and the automatic sign-out after a spell without activity. The sections themselves are the
 * Studio views in app.js, seller.js, express.js, reseller.js and growth.js. Everything here is private to
 * this file except the few functions app.js calls, which are put on window at the end.
 */
(() => {

const ROLE_INFO = {
  owner: { label: 'Owner', text: 'Everything, including staff accounts, roles and the audit log.' },
  manager: { label: 'Manager', text: 'Runs the store: orders, catalog, sellers, deliveries, payouts and marketing. No staff or audit log.' },
  support: { label: 'Support', text: 'Helps buyers: reads orders and customers, answers the help desk and handles returns.' },
};
const EXTRA_SECTIONS = { account: 'My account' };

const gate = $('#gate');
const shell = $('#shell');
let idleMinutes = 30;

/** The menu entry for a section, if the signed-in person's role includes it. */
function adminSection(key) {
  if (EXTRA_SECTIONS[key]) return { key, label: EXTRA_SECTIONS[key] };
  return (state.user?.sections || []).find((s) => s.key === key) || null;
}

function adminGreeting() {
  const hour = Number(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return h('div', { class: 'adm-hello' }, h('h2', null, `${part}, ${state.user.name.split(' ')[0]}`),
    h('p', { class: 'muted' }, `Signed in as ${ROLE_INFO[state.user.staffRole].label}. Here is how the store is doing today.`));
}

// ---------------- Layout: menu, top bar, account menu ----------------
function adminChrome(active) {
  const nav = $('#nav');
  const groups = new Map();
  for (const s of state.user.sections) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group).push(s);
  }
  fill(nav, [...groups].map(([group, items]) => h('div', { class: 'adm-group' },
    h('div', { class: 'adm-group-title' }, group),
    items.map((s) => h('a', { href: `#/admin?tab=${s.key}`, class: s.key === active ? 'on' : '', 'aria-current': s.key === active ? 'page' : null }, s.label)))));
  const section = adminSection(active);
  $('#adm-title').textContent = section ? section.label : 'Admin';
  $('#adm-crumb').textContent = section && section.group ? section.group : '';
  document.title = `${section ? section.label : 'Admin'} · Bazaario Admin`;
  closeMenu();
}

const closeMenu = () => {
  $('#side').classList.remove('open');
  $('#scrim').hidden = true;
  $('#burger').setAttribute('aria-expanded', 'false');
};

function wireChrome() {
  $('#burger').addEventListener('click', () => {
    const open = !$('#side').classList.contains('open');
    $('#side').classList.toggle('open', open);
    $('#scrim').hidden = !open;
    $('#burger').setAttribute('aria-expanded', String(open));
  });
  $('#scrim').addEventListener('click', closeMenu);
  const menu = $('#me-menu');
  const btn = $('#me-btn');
  const setMenu = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menu.hidden); });
  document.addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setMenu(false); closeMenu(); } });
  $('#signout').addEventListener('click', () => signOut());
  $('#idle-stay').addEventListener('click', async () => {
    $('#idle-modal').close();
    markActive();
    await api('GET', '/admin/auth/me').catch(() => {});
    lastPing = Date.now();
  });
  $('#idle-out').addEventListener('click', () => signOut());
}

function paintUser() {
  const u = state.user;
  $('#me-name').textContent = u.name;
  $('#me-role').textContent = ROLE_INFO[u.staffRole].label;
  $('#me-avatar').textContent = u.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const t = state.config.testMode || {};
  $('#test-pill').hidden = !(t.payments || t.courier || t.sms);
}

// ---------------- Signing in ----------------
function showGate(...nodes) {
  shell.hidden = true;
  gate.hidden = false;
  document.title = 'Sign in · Bazaario Admin';
  gate.replaceChildren(h('div', { class: 'adm-gate-card' },
    h('div', { class: 'adm-gate-brand' }, h('span', { class: 'logo-mark', 'aria-hidden': 'true' }, 'B'), h('span', null, h('b', null, 'Bazaario'), h('small', null, 'Admin portal'))),
    ...nodes),
  h('p', { class: 'adm-gate-foot' }, h('a', { href: '/' }, '← Back to the store')));
  const first = gate.querySelector('input');
  if (first) first.focus();
}

const errBox = () => h('div', { class: 'alert alert-err hidden', role: 'alert' });
const showErr = (box, msg) => { box.textContent = msg; box.classList.remove('hidden'); };
const field = (label, input, hint) => h('div', { class: 'adm-field' }, h('label', null, label), input, hint ? h('div', { class: 'hint' }, hint) : null);

function viewSignIn(notice) {
  const email = h('input', { type: 'email', required: true, autocomplete: 'username', maxLength: 254 });
  const pw = h('input', { type: 'password', required: true, autocomplete: 'current-password', maxLength: 128 });
  const err = errBox();
  const btn = h('button', { class: 'btn btn-primary btn-block' }, 'Sign in');
  showGate(h('h1', null, 'Sign in'), h('p', { class: 'muted' }, 'For store staff.'),
    notice ? h('div', { class: 'alert alert-test', role: 'status' }, notice) : null, err,
    h('form', { onsubmit: async (e) => {
      e.preventDefault(); err.classList.add('hidden'); btn.disabled = true;
      try {
        const r = await api('POST', '/admin/auth/login', { email: email.value, password: pw.value });
        if (r.user) startPortal(r); else viewCode(r);
      } catch (ex) { showErr(err, ex.message); btn.disabled = false; pw.value = ''; pw.focus(); }
    } }, field('Email', email), field('Password', pw), btn),
    h('p', { class: 'hint adm-center' }, 'Forgot your password? Ask the store owner to reset your access.'));
}

function viewSetup() {
  const name = h('input', { required: true, maxLength: 60, autocomplete: 'name', placeholder: 'First and last name' });
  const email = h('input', { type: 'email', required: true, autocomplete: 'email', maxLength: 254 });
  const pw = h('input', { type: 'password', required: true, minLength: 8, maxLength: 128, autocomplete: 'new-password' });
  const pw2 = h('input', { type: 'password', required: true, autocomplete: 'new-password' });
  const err = errBox();
  const btn = h('button', { class: 'btn btn-primary btn-block' }, 'Create owner account');
  showGate(h('h1', null, 'Set up your store'),
    h('p', { class: 'muted' }, 'Create the owner account. You do this once; after that, add staff from Staff and roles.'), err,
    h('form', { onsubmit: async (e) => {
      e.preventDefault(); err.classList.add('hidden');
      if (pw.value !== pw2.value) return showErr(err, 'Passwords do not match.');
      btn.disabled = true;
      try {
        startPortal(await api('POST', '/admin/auth/setup', { name: name.value, email: email.value, password: pw.value }));
        toast('Your store is ready. Welcome to Bazaario Admin!');
      } catch (ex) { showErr(err, ex.message); btn.disabled = false; }
    } }, field('Your name', name), field('Email', email), field('Password', pw, 'At least 8 characters, with letters and numbers.'),
    field('Re-enter password', pw2), btn));
}

/**
 * Second screen, only when needed: new staff choose their own password, and people who turned on the
 * optional authenticator code enter it (or a recovery code).
 */
function viewCode(ch, useRecovery = false) {
  const err = errBox();
  const code = !ch.twoStep ? null : useRecovery
    ? h('input', { required: true, maxLength: 9, autocomplete: 'off', placeholder: 'XXXX-XXXX', class: 'adm-code adm-code-rc' })
    : h('input', { required: true, maxLength: 6, minLength: 6, inputMode: 'numeric', pattern: '[0-9]{6}', autocomplete: 'one-time-code', placeholder: '000000', class: 'adm-code' });
  const npw = h('input', { type: 'password', minLength: 8, maxLength: 128, autocomplete: 'new-password', required: ch.mustChangePassword });
  const npw2 = h('input', { type: 'password', autocomplete: 'new-password', required: ch.mustChangePassword });
  const btn = h('button', { class: 'btn btn-primary btn-block' }, 'Sign in');
  const submit = async (e) => {
    e.preventDefault(); err.classList.add('hidden');
    if (ch.mustChangePassword && npw.value !== npw2.value) return showErr(err, 'The new passwords do not match.');
    btn.disabled = true;
    try {
      const r = await api('POST', '/admin/auth/verify', { challenge: ch.challenge, code: code ? code.value : undefined, newPassword: ch.mustChangePassword ? npw.value : undefined });
      if (r.recoveryCodesLeft !== undefined && r.recoveryCodesLeft <= 3) toast(`You have ${r.recoveryCodesLeft} recovery codes left. Get new ones under My account.`);
      startPortal(r);
    } catch (ex) {
      btn.disabled = false;
      if (code) { code.value = ''; code.focus(); }
      if (/timed out|Too many/.test(ex.message)) return viewSignIn(ex.message);
      showErr(err, ex.message);
    }
  };
  const first = ch.name ? ch.name.split(' ')[0] : '';
  showGate(h('h1', null, ch.mustChangePassword ? `Welcome${first ? ', ' + first : ''}` : `Hello${first ? ', ' + first : ''}`),
    h('p', { class: 'muted' }, ch.mustChangePassword ? 'Choose your own password to replace the temporary one the owner gave you.'
      : useRecovery ? 'Enter one of the recovery codes you saved. Each code works once.' : 'Enter the 6-digit code from your authenticator app.'), err,
    h('form', { onsubmit: submit },
      ch.mustChangePassword ? [field('New password', npw, 'At least 8 characters, with letters and numbers.'), field('Re-enter new password', npw2)] : null,
      code ? field(useRecovery ? 'Recovery code' : 'Code from your app', code) : null, btn),
    code ? h('p', { class: 'adm-center' }, h('button', { type: 'button', class: 'link-btn', onclick: () => viewCode(ch, !useRecovery) },
      useRecovery ? 'Use the code from my app instead' : 'Lost your phone? Use a recovery code')) : null);
}

function recoveryList(codes) {
  const text = `Bazaario Admin recovery codes for ${state.user?.email || ''}\nEach code works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n`;
  const download = () => {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'bazaario-admin-recovery-codes.txt' });
    document.body.append(a); a.click(); a.remove();
  };
  return [h('ol', { class: 'adm-codes' }, codes.map((c) => h('li', null, h('code', null, c)))),
    h('div', { class: 'adm-row' },
      h('button', { type: 'button', class: 'btn btn-outline', onclick: () => navigator.clipboard.writeText(text).then(() => toast('Recovery codes copied.'), () => toast('Copy did not work. Please download them instead.', true)) }, 'Copy'),
      h('button', { type: 'button', class: 'btn btn-outline', onclick: download }, 'Download .txt'))];
}

// ---------------- Signed in ----------------
function startPortal(r) {
  state.user = r.user;
  state.csrf = r.csrfToken;
  idleMinutes = r.idleMinutes || 30;
  gate.hidden = true;
  gate.replaceChildren();
  shell.hidden = false;
  paintUser();
  markActive();
  lastPing = Date.now();
  if (!/^#\/(admin|doc)\b/.test(location.hash)) location.replace('#/admin');
  route();
}

async function signOut(message) {
  await api('POST', '/admin/auth/logout').catch(() => {});
  adminSignedOut(message || 'You have signed out.');
}

/** Called when the server says the portal session has ended (signed out, idle or reset by the owner). */
function adminSignedOut(message) {
  state.user = null;
  state.csrf = null;
  state.timers.forEach(clearInterval);
  state.timers = [];
  if ($('#idle-modal').open) $('#idle-modal').close();
  if ($('#modal').open) $('#modal').close();
  viewSignIn(message);
}

// ---------------- Automatic sign-out after inactivity ----------------
let lastActive = Date.now();
let lastPing = Date.now();
const markActive = () => { lastActive = Date.now(); };
['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'].forEach((ev) => window.addEventListener(ev, () => {
  if (!$('#idle-modal').open) markActive();
}, { passive: true }));

setInterval(async () => {
  if (!state.user) return;
  const idleMs = Date.now() - lastActive;
  const limit = idleMinutes * 60000;
  const warnAt = limit - 2 * 60000;
  if (idleMs >= limit) { signOut(`You were signed out after ${idleMinutes} minutes without activity.`); return; }
  if (idleMs >= warnAt) {
    const left = Math.ceil((limit - idleMs) / 1000);
    $('#idle-left').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (!$('#idle-modal').open) $('#idle-modal').showModal();
    return;
  }
  // Someone working on a page without saving anything is still active: tell the server now and then.
  if (lastActive > lastPing && Date.now() - lastPing > 5 * 60000) {
    lastPing = Date.now();
    await api('GET', '/admin/auth/me').then((me) => { if (!me.user) adminSignedOut('Your session has ended. Please sign in again.'); }).catch(() => {});
  }
}, 1000);

// ---------------- Staff and roles (owner) ----------------
function tempPasswordModal(title, who, password) {
  const modal = $('#modal');
  const link = `${location.origin}/admin`;
  const text = `Sign in to Bazaario Admin at ${link}\nEmail: ${who.email}\nTemporary password: ${password}\nYou will choose your own password when you first sign in.`;
  $('#modal-body').replaceChildren(h('h3', null, title),
    h('p', { class: 'muted small' }, `Share these details with ${who.name} privately. The temporary password is shown only now.`),
    h('table', { class: 'details' },
      h('tr', null, h('th', null, 'Sign in at'), h('td', null, link)),
      h('tr', null, h('th', null, 'Email'), h('td', null, who.email)),
      h('tr', null, h('th', null, 'Temporary password'), h('td', null, h('code', { class: 'adm-secret' }, password)))),
    h('div', { class: 'adm-row' },
      h('button', { class: 'btn btn-primary', onclick: () => navigator.clipboard.writeText(text).then(() => toast('Details copied.'), () => toast('Copy did not work. Please note them down.', true)) }, 'Copy details'),
      h('button', { class: 'btn btn-outline', onclick: () => modal.close() }, 'Done')));
  modal.showModal();
}

async function adminStaff(body) {
  const { staff, roles } = await api('GET', '/admin/staff');
  const name = h('input', { required: true, maxLength: 60, placeholder: 'Full name' });
  const email = h('input', { type: 'email', required: true, maxLength: 254, placeholder: 'name@example.com' });
  const role = h('select', null, roles.map((r) => h('option', { value: r.key, selected: r.key === 'support' }, r.label)));
  const roleHint = h('div', { class: 'hint' });
  const paintHint = () => { roleHint.textContent = ROLE_INFO[role.value].text; };
  role.addEventListener('change', paintHint); paintHint();
  const formCard = h('div', { class: 'card adm-add hidden' }, h('h3', null, 'Add a staff member'),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await api('POST', '/admin/staff', { name: name.value, email: email.value, staffRole: role.value });
        await route();
        tempPasswordModal('Staff member added', r.staff, r.tempPassword);
      } catch (ex) { fail(ex); }
    } }, h('div', { class: 'form-grid' }, field('Name', name), field('Email', email), h('div', { class: 'full' }, field('Role', role), roleHint)),
    h('div', { class: 'adm-row' }, h('button', { class: 'btn btn-primary' }, 'Add and create a temporary password'),
      h('button', { type: 'button', class: 'btn btn-outline', onclick: () => formCard.classList.add('hidden') }, 'Cancel'))));

  const changeRole = async (s, value) => {
    try { await api('PATCH', `/admin/staff/${s.id}`, { staffRole: value }); toast(`${s.name} is now ${ROLE_INFO[value].label}.`); route(); } catch (ex) { fail(ex); route(); }
  };
  const reset = async (s) => {
    if (!(await askConfirm(`Reset access for ${s.name}? They are signed out everywhere and get a new temporary password. Their sign-in code, if on, is turned off.`, 'Reset access'))) return;
    try { const r = await api('POST', `/admin/staff/${s.id}/reset`); route(); tempPasswordModal('Access reset', s, r.tempPassword); } catch (ex) { fail(ex); }
  };
  const remove = async (s) => {
    if (!(await askConfirm(`Remove ${s.name} from staff? They are signed out at once and can no longer open the portal.`, 'Remove'))) return;
    try { await api('DELETE', `/admin/staff/${s.id}`); toast(`${s.name} was removed from staff.`); route(); } catch (ex) { fail(ex); }
  };

  add(body,
    h('div', { class: 'adm-roles' }, Object.entries(ROLE_INFO).map(([k, r]) => h('div', { class: 'card' },
      h('span', { class: `adm-badge adm-badge-${k}` }, r.label), h('p', { class: 'small' }, r.text),
      h('div', { class: 'hint' }, `${staff.filter((s) => s.staffRole === k).length} on the team`)))),
    h('div', { class: 'adm-bar' }, h('h2', null, `Team (${staff.length})`),
      h('button', { class: 'btn btn-primary', onclick: () => { formCard.classList.remove('hidden'); name.focus(); } }, 'Add a staff member')),
    formCard,
    h('div', { class: 'table-wrap' }, h('table', null,
      h('tr', null, ['Person', 'Role', 'Sign-in code', 'Last sign-in', ''].map((t) => h('th', null, t))),
      staff.map((s) => h('tr', null,
        h('td', null, h('b', null, s.name), s.you ? h('span', { class: 'adm-you' }, 'You') : null, h('div', { class: 'hint' }, s.email)),
        h('td', null, s.you ? h('span', { class: `adm-badge adm-badge-${s.staffRole}` }, s.roleLabel)
          : h('select', { 'aria-label': `Role for ${s.name}`, onchange: (e) => changeRole(s, e.target.value) },
            roles.map((r) => h('option', { value: r.key, selected: r.key === s.staffRole }, r.label)))),
        h('td', null, s.pendingFirstSignIn ? h('span', { class: 'low' }, 'Waiting for first sign-in')
          : s.twoFactor ? h('span', { class: 'ok' }, 'On') : h('span', { class: 'muted' }, 'Off'),
          s.locked ? h('div', { class: 'hint err' }, 'Locked after wrong passwords') : null),
        h('td', null, s.lastSignIn ? fmtWhen(s.lastSignIn) : 'Never'),
        h('td', null, s.you ? h('a', { class: 'hint', href: '#/admin?tab=account' }, 'My account') : h('div', { class: 'line-actions' },
          h('button', { class: 'link-btn', onclick: () => reset(s) }, 'Reset access'),
          h('button', { class: 'link-btn danger', onclick: () => remove(s) }, 'Remove'))))))));
}

// ---------------- My account ----------------
async function adminAccount(body) {
  const sec = await api('GET', '/admin/auth/security');
  const cur = h('input', { type: 'password', required: true, autocomplete: 'current-password', maxLength: 128 });
  const npw = h('input', { type: 'password', required: true, minLength: 8, maxLength: 128, autocomplete: 'new-password' });
  const npw2 = h('input', { type: 'password', required: true, autocomplete: 'new-password' });
  const u = state.user;
  add(body, h('div', { class: 'adm-cols' },
    h('div', { class: 'card' }, h('h3', null, 'Profile'),
      h('table', { class: 'details' },
        h('tr', null, h('th', null, 'Name'), h('td', null, u.name)),
        h('tr', null, h('th', null, 'Email'), h('td', null, u.email)),
        h('tr', null, h('th', null, 'Role'), h('td', null, h('span', { class: `adm-badge adm-badge-${u.staffRole}` }, ROLE_INFO[u.staffRole].label),
          h('div', { class: 'hint' }, ROLE_INFO[u.staffRole].text))),
        h('tr', null, h('th', null, 'Last sign-in'), h('td', null, sec.lastSignIn ? fmtWhen(sec.lastSignIn) : '—')),
        h('tr', null, h('th', null, 'Automatic sign-out'), h('td', null, `After ${idleMinutes} minutes without activity`))),
      h('button', { class: 'btn btn-outline', onclick: () => signOut() }, 'Sign out')),
    h('div', { class: 'card' }, h('h3', null, 'Change password'),
      h('p', { class: 'hint' }, 'Signs you out of every other device, including the shop.'),
      h('form', { onsubmit: async (e) => {
        e.preventDefault();
        if (npw.value !== npw2.value) return toast('The new passwords do not match.', true);
        try {
          const r = await api('POST', '/admin/auth/password', { currentPassword: cur.value, newPassword: npw.value });
          state.csrf = r.csrfToken; e.target.reset(); toast('Password changed.');
        } catch (ex) { fail(ex); }
      } }, field('Current password', cur), field('New password', npw, 'At least 8 characters, with letters and numbers.'), field('Re-enter new password', npw2),
      h('button', { class: 'btn btn-primary' }, 'Change password'))),
    h('div', { class: 'card' }, h('h3', null, 'Sign-in code (optional)'), twoStepCard(sec))));
}

/**
 * The optional authenticator code. Off by default: sign-in is the email and password. When it is on, each
 * sign-in also asks for the 6-digit code from an app on the phone.
 */
function twoStepCard(sec) {
  const box = h('div');
  const askPassword = (label, then) => {
    const pw = h('input', { type: 'password', required: true, autocomplete: 'current-password', maxLength: 128 });
    fill(box, h('form', { onsubmit: async (e) => { e.preventDefault(); try { await then(pw.value); } catch (ex) { fail(ex); } } },
      field('Your password', pw), h('div', { class: 'adm-row' }, h('button', { class: 'btn btn-outline' }, label),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: rest }, 'Cancel'))));
    pw.focus();
  };
  const scan = (ch, turningOn) => {
    const code = h('input', { required: true, maxLength: 6, inputMode: 'numeric', pattern: '[0-9]{6}', autocomplete: 'one-time-code', placeholder: '000000', class: 'adm-code' });
    fill(box, h('p', { class: 'small' }, turningOn
      ? 'Install Google Authenticator, Microsoft Authenticator or Authy, scan this code with it, then enter the 6 digits it shows.'
      : 'Scan this with the authenticator app on your new phone, then enter the code it shows.'),
      h('div', { class: 'adm-qr' }, h('img', { src: ch.enrol.qr, alt: 'QR code for your authenticator app', width: 140, height: 140 }),
        h('div', null, h('span', { class: 'hint' }, 'Or enter this setup key:'), h('code', { class: 'adm-secret' }, ch.enrol.secret))),
      h('form', { onsubmit: async (e) => {
        e.preventDefault();
        try {
          const r = await api('POST', '/admin/auth/authenticator/confirm', { challenge: ch.challenge, code: code.value });
          if (r.recoveryCodes) {
            fill(box, h('div', { class: 'alert alert-ok' }, 'The sign-in code is on. Save these recovery codes: each one lets you sign in once if you lose your phone.'),
              recoveryList(r.recoveryCodes), h('button', { class: 'btn btn-primary', onclick: () => route() }, 'Done'));
          } else {
            fill(box, h('div', { class: 'alert alert-ok' }, 'Done. Sign-in codes now come from your new phone; the old one no longer works.'));
          }
        } catch (ex) { fail(ex); code.value = ''; }
      } }, field('Code from the app', code), h('div', { class: 'adm-row' }, h('button', { class: 'btn btn-primary' }, turningOn ? 'Turn on' : 'Switch to the new phone'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: rest }, 'Cancel'))));
    code.focus();
  };
  const renew = () => {
    const code = h('input', { required: true, maxLength: 6, inputMode: 'numeric', pattern: '[0-9]{6}', autocomplete: 'one-time-code', placeholder: '000000', class: 'adm-code' });
    fill(box, h('form', { onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await api('POST', '/admin/auth/recovery-codes', { code: code.value });
        fill(box, h('div', { class: 'alert alert-ok' }, 'New codes are ready. Your old codes no longer work.'), recoveryList(r.recoveryCodes));
      } catch (ex) { fail(ex); code.value = ''; }
    } }, field('Code from your app', code), h('div', { class: 'adm-row' }, h('button', { class: 'btn btn-outline' }, 'Get new recovery codes'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: rest }, 'Cancel'))));
    code.focus();
  };
  const rest = () => {
    if (!sec.twoStep) {
      return fill(box, h('p', null, h('span', { class: 'muted' }, 'Off.'), ' You sign in with your email and password.'),
        h('p', { class: 'hint' }, 'For extra safety you can also ask for a 6-digit code from an app on your phone at each sign-in.'),
        h('button', { class: 'btn btn-outline', onclick: () => askPassword('Continue', async (pw) => scan(await api('POST', '/admin/auth/authenticator', { password: pw }), true)) }, 'Turn on'));
    }
    fill(box, h('p', null, h('span', { class: 'ok' }, 'On.'), ' Each sign-in also asks for the code from your authenticator app.'),
      h('p', { class: sec.recoveryCodesLeft <= 3 ? 'err' : 'hint' }, `${sec.recoveryCodesLeft} of 10 recovery codes left.`),
      h('div', { class: 'line-actions' },
        h('button', { class: 'link-btn', onclick: renew }, 'Get new recovery codes'),
        h('button', { class: 'link-btn', onclick: () => askPassword('Continue', async (pw) => scan(await api('POST', '/admin/auth/authenticator', { password: pw }), false)) }, 'Set up a new phone'),
        h('button', { class: 'link-btn danger', onclick: () => askPassword('Turn off', async (pw) => {
          await api('POST', '/admin/auth/authenticator/off', { password: pw }); toast('The sign-in code is off.'); route();
        }) }, 'Turn off')));
  };
  rest();
  return box;
}

// ---------------- Start ----------------
async function initAdmin() {
  wireChrome();
  window.addEventListener('hashchange', () => { if (state.user) route(); });
  let me = { user: null };
  try {
    const [cfg, cats, who] = await Promise.all([api('GET', '/config'), api('GET', '/categories'), api('GET', '/admin/auth/me')]);
    state.config = cfg;
    state.categories = cats.categories;
    me = who;
  } catch {
    showGate(h('h1', null, 'Cannot reach the store'), h('p', { class: 'muted' }, 'Check your internet connection, then reload this page.'));
    return;
  }
  if (me.user) return startPortal(me);
  if (me.setupNeeded) return viewSetup();
  viewSignIn(me.ended === 'idle' ? 'You were signed out because there was no activity for a while.' : null);
}

Object.assign(window, { adminSection, adminGreeting, adminChrome, adminStaff, adminAccount, adminSignedOut });
initAdmin();
})();
