import { listRounds } from '../db.js';
import { esc } from '../util.js';
import { roundLabel } from '../halbserie.js';

export async function renderHome(app) {
  const rounds = await listRounds();
  app.innerHTML = `<h1>Halbserien</h1>` + (rounds.length
    ? rounds.map((r) => `<div class="card"><a href="#/runde/${esc(r.id)}"><strong>${esc(roundLabel(r))} · ${r.playerCount} Mitspieler</strong></a></div>`).join('')
    : '<div class="msg">Noch keine Halbserie hochgeladen. Die Verwaltung (Admin) kann Excel-Dateien hochladen.</div>');
}
