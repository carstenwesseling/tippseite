import { configured, login, logout, onUser } from './firebase.js';
import { checkAdmin } from './db.js';
import { esc, $ } from './util.js';
import { renderHome } from './pages/home.js';
import { renderTable } from './pages/table.js';
import { renderAdmin } from './pages/admin.js';

export const session = { user: null, isAdmin: false };

const app = $('#app');

async function route() {
  markNav();
  const [, page, id] = location.hash.split('/');
  if (!configured) {
    app.innerHTML = `<div class="card"><h2>Firebase nicht konfiguriert</h2>
      <p>Lege eine <code>.env</code> nach Vorlage <code>.env.example</code> an und starte neu.</p></div>`;
    return;
  }
  app.innerHTML = '<p class="muted">Lade …</p>';
  try {
    if (page === 'admin') await renderAdmin(app, session);
    else if (page === 'runde' && id) await renderTable(app, session, id);
    else await renderHome(app);
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
  $('#nav-admin').toggleAttribute('aria-current', admin);
  $('#nav-home').toggleAttribute('aria-current', !admin);
}

onUser(async (user) => {
  session.user = user;
  session.isAdmin = configured ? await checkAdmin(user) : false;
  renderUser();
  route();
});
addEventListener('hashchange', route);
