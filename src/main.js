import { configured, login, logout, onUser } from './firebase.js';
import { checkAdmin } from './db.js';
import { esc, $ } from './util.js';
import { renderHome } from './pages/home.js';
import { renderTable } from './pages/table.js';
import { renderAdmin } from './pages/admin.js';
import { renderMembers, renderMember } from './pages/members.js';

export const session = { user: null, isAdmin: false };

const app = $('#app');

async function route() {
  const [, page, id, id2] = location.hash.split('/');
  if (!configured) {
    app.innerHTML = `<div class="card"><h2>Firebase nicht konfiguriert</h2>
      <p>Lege eine <code>.env</code> nach Vorlage <code>.env.example</code> an und starte neu.</p></div>`;
    return;
  }
  app.innerHTML = '<p class="muted">Lade …</p>';
  try {
    if (page === 'admin' && id === 'mitglieder') await renderMembers(app, session);
    else if (page === 'admin' && id === 'mitglied' && id2) await renderMember(app, session, decodeURIComponent(id2));
    else if (page === 'admin') await renderAdmin(app, session);
    else if (page === 'runde' && id) await renderTable(app, session, id);
    else await renderHome(app);
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="msg err">Fehler: ${esc(e.message)}</div>`;
  }
}

function renderUser() {
  const el = $('#user');
  el.innerHTML = session.user
    ? `${esc(session.user.displayName || session.user.email)}${session.isAdmin ? ' (Admin)' : ''} <button id="out">Abmelden</button>`
    : '<button id="in">Mit Google anmelden</button>';
  $('#out')?.addEventListener('click', () => logout());
  $('#in')?.addEventListener('click', () => login().catch((e) => alert(e.message)));
}

onUser(async (user) => {
  session.user = user;
  session.isAdmin = configured ? await checkAdmin(user) : false;
  renderUser();
  route();
});
addEventListener('hashchange', route);
