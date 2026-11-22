import { configured, login, logout, onUser } from './firebase.js';
import { checkAdmin } from './db.js';
import { esc, $, enableSort } from './util.js';
import { renderHome } from './pages/home.js';
import { renderTable, stopPolling } from './pages/table.js';
import { renderBestenliste } from './pages/bestenliste.js';
import { renderAdmin } from './pages/admin.js';
import { renderMembers, renderMember } from './pages/members.js';

export const session = { user: null, isAdmin: false };

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
    if (page === 'bestenliste') await renderBestenliste(app, session);
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

function renderUser() {
  const el = $('#user');
  const u = session.user;
  if (!u) {
    el.innerHTML = '<button class="linkbtn" id="in">Anmelden</button>';
    $('#in').addEventListener('click', () => login().catch((e) => alert(e.message)));
    return;
  }
  const name = u.displayName || u.email || '?';
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  el.innerHTML = `<a class="avatar" href="#/admin" title="${esc(name)}${session.isAdmin ? ' (Admin)' : ''}">${esc(initials)}</a>`;
}

function markNav() {
  const admin = location.hash.startsWith('#/admin');
  const best = location.hash.startsWith('#/bestenliste');
  $('#nav-admin').toggleAttribute('aria-current', admin);
  $('#nav-best').toggleAttribute('aria-current', best);
  $('#nav-home').toggleAttribute('aria-current', !admin && !best);
}

onUser(async (user) => {
  session.user = user;
  session.isAdmin = configured ? await checkAdmin(user) : false;
  renderUser();
  route();
});
addEventListener('hashchange', route);
app.addEventListener('click', (e) => { if (e.target.closest('[data-logout]')) logout(); });
