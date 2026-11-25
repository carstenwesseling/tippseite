import { configured, login, loginDelegate, logout, onUser } from './firebase.js';
import { getAdminInfo, getDelegate, getTipping } from './db.js';
import { esc, $, enableSort } from './util.js';
import { renderHome } from './pages/home.js';
import { renderTable, stopPolling } from './pages/table.js';
import { renderBestenliste, renderBestenlisteMember } from './pages/bestenliste.js';
import { renderAdmin } from './pages/admin.js';
import { renderMembers, renderMember } from './pages/members.js';
import { renderTippen } from './pages/tippen.js';
import { renderTippfete } from './pages/tippfete.js';
import { renderTippfeteAdmin } from './pages/tippfeteadmin.js';
import { renderTipAdmin } from './pages/tipadmin.js';
import { renderBenutzer } from './pages/benutzer.js';

export const session = { user: null, isAdmin: false, isOwner: false, name: '' };

const app = $('#app');

async function route() {
  stopPolling();
  markNav();
  const [, page, id, id2] = location.hash.split('/');
  if (!configured) {
    app.innerHTML = `<div class="card"><h2>Firebase nicht konfiguriert</h2>
      <p>Lege eine <code>.env</code> nach Vorlage <code>.env.example</code> an und starte neu.</p></div>`;
    return;
  }
  app.innerHTML = '<p class="muted">Lade …</p>';
  try {
    if (page === 'bestenliste' && id) await renderBestenlisteMember(app, session, decodeURIComponent(id));
    else if (page === 'bestenliste') await renderBestenliste(app, session);
    else if (page === 'tippfete') await renderTippfete(app, session);
    else if (page === 'tippen') await renderTippen(app, session);
    else if (page === 'admin' && id === 'tippfete') await renderTippfeteAdmin(app, session);
    else if (page === 'admin' && id === 'tippen') await renderTipAdmin(app, session);
    else if (page === 'admin' && id === 'benutzer') await renderBenutzer(app, session);
    else if (page === 'admin' && id === 'mitglieder') await renderMembers(app, session);
    else if (page === 'admin' && id === 'mitglied' && id2) await renderMember(app, session, decodeURIComponent(id2));
    else if (page === 'admin') await renderAdmin(app, session);
    else if (page === 'runde' && id) await renderTable(app, session, id);
    else await renderHome(app, session);
    enableSort(app);
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="msg err">Fehler: ${esc(e.message)}</div>`;
  }
}

/** Anmeldedialog: Besitzer per Google, der hinterlegte Admin per Name + 4-stelliger PIN. */
async function openLogin() {
  const delegate = await getDelegate().catch(() => null);
  const dlg = document.createElement('dialog');
  dlg.className = 'logindlg';
  dlg.innerHTML = `<form method="dialog"><h3>Anmelden</h3>
    <div class="row"><button type="button" id="l-google">Mit Google anmelden (Besitzer)</button></div>
    ${delegate ? `<hr /><p class="muted">Als <strong>${esc(delegate.name)}</strong> anmelden:</p>
    <div class="row"><input id="l-pin" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*" placeholder="PIN (4 Ziffern)" autocomplete="off" style="width:9rem" />
      <button type="button" id="l-pinbtn">Anmelden</button></div>` : ''}
    <div id="l-msg"></div><div class="row"><button value="cancel">Abbrechen</button></div></form>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  const msg = (t) => { dlg.querySelector('#l-msg').innerHTML = `<div class="msg err">${esc(t)}</div>`; };
  dlg.querySelector('#l-google').addEventListener('click', () => { login().then(() => dlg.close()).catch((e) => msg(e.message)); });
  const pinLogin = () => {
    const pin = dlg.querySelector('#l-pin').value;
    if (!/^\d{4}$/.test(pin)) return msg('Bitte die 4-stellige PIN eingeben.');
    loginDelegate(delegate.name, pin).then(() => dlg.close()).catch((e) => msg(e.message));
  };
  dlg.querySelector('#l-pinbtn')?.addEventListener('click', pinLogin);
  dlg.querySelector('#l-pin')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pinLogin(); } });
  dlg.showModal();
}

function renderUser() {
  const el = $('#user');
  const u = session.user;
  if (!u) {
    el.innerHTML = '<button class="linkbtn" id="in">Anmelden</button>';
    const btn = $('#in');
    btn.addEventListener('click', openLogin);
    return;
  }
  const name = session.name || u.displayName || u.email || '?';
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  el.innerHTML = `<a class="avatar" href="#/admin" title="${esc(name)}${session.isAdmin ? ' (Admin)' : ''}">${esc(initials)}</a>`;
}

let tippenOpen = false; // Tipprunde offen und gefüllt?
const loadTippenState = async () => {
  try { const t = configured ? await getTipping() : null; tippenOpen = Boolean(t?.open && t.order?.length); } catch { tippenOpen = false; }
};

function markNav() {
  const h = location.hash;
  const admin = h.startsWith('#/admin');
  const best = h.startsWith('#/bestenliste');
  const tippen = h.startsWith('#/tippen');
  const fete = h.startsWith('#/tippfete');
  $('#nav-admin').toggleAttribute('aria-current', admin);
  $('#nav-best').toggleAttribute('aria-current', best);
  $('#nav-tippen').toggleAttribute('aria-current', tippen);
  $('#nav-tippfete').toggleAttribute('aria-current', fete);
  $('#nav-home').toggleAttribute('aria-current', !admin && !best && !tippen && !fete);
  // ausgegraut, wenn nichts angezeigt werden kann (Tipprunde nicht offen bzw. nicht angemeldet)
  $('#nav-tippen').classList.toggle('off', !tippenOpen);
  $('#nav-admin').classList.toggle('off', !session.user);
}

onUser(async (user) => {
  session.user = user;
  const info = configured ? await getAdminInfo(user) : null;
  session.isAdmin = Boolean(info);
  session.isOwner = Boolean(info?.owner);
  session.name = info && !info.owner ? info.name : '';
  renderUser();
  await loadTippenState();
  route();
});
addEventListener('hashchange', route);
app.addEventListener('click', (e) => { if (e.target.closest('[data-logout]')) logout(); });
