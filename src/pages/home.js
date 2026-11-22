import { listRounds } from '../db.js';
import { compareRounds } from '../halbserie.js';
import { renderTable } from './table.js';

<<<<<<< HEAD
export async function renderHome(app) {
  const rounds = await listRounds();
  app.innerHTML = '<h1>Halbserien</h1>' + (rounds.length
    ? `<div class="rounds">${rounds.map((r) => `<a class="round" href="#/runde/${esc(r.id)}"><span><strong>${esc(r.title)}</strong>
        <span class="muted" style="display:block">${esc(r.typ === 'hin' ? 'Hinrunde' : 'Rückrunde')} · Saison ${esc(r.jahr)}/${String(+r.jahr + 1).slice(2)}</span></span>
        <span class="muted">${r.playerCount} Mitspieler</span></a>`).join('')}</div>`
    : '<div class="msg">Noch keine Halbserie hochgeladen. Die Verwaltung (Admin) kann Excel-Dateien hochladen.</div>');
=======
/** Startseite: die aktuelle Halbserie ist immer aufgeklappt; andere Halbserien wählt man im Dropdown. */
export async function renderHome(app, session) {
  const rounds = (await listRounds()).sort(compareRounds);
  if (rounds.length) return renderTable(app, session, rounds[0].id);
  app.innerHTML = '<h1>Halbserien</h1><div class="msg">Noch keine Halbserie hochgeladen. Die Verwaltung (Admin) kann Excel-Dateien hochladen.</div>';
>>>>>>> origin/main
}
