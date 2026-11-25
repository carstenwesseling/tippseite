import { listRounds } from '../db.js';
import { compareRounds } from '../halbserie.js';
import { renderTable } from './table.js';

/** Startseite: die aktuelle Halbserie ist immer aufgeklappt; andere Halbserien wählt man im Dropdown. */
export async function renderHome(app, session) {
  const rounds = (await listRounds()).sort(compareRounds);
  if (rounds.length) {
    await renderTable(app, session, rounds[0].id);
    return;
  }
  app.innerHTML = '<h1>Halbserien</h1><div class="msg">Noch keine Halbserie hochgeladen. Die Verwaltung (Admin) kann Excel-Dateien hochladen.</div>';
}
