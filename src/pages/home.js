import { listRounds } from '../db.js';
import { esc } from '../util.js';
import { roundLabel } from '../halbserie.js';

export async function renderHome(app) {
  const rounds = await listRounds();
  app.innerHTML = '<h1>Halbserien</h1>' + (rounds.length
    ? `<div class="rounds">${rounds.map((r) => `<a class="round" href="#/runde/${esc(r.id)}"><strong>${esc(roundLabel(r))}</strong>
        <span class="muted">${r.playerCount} Mitspieler</span></a>`).join('')}</div>`
    : '<div class="msg">Noch keine Halbserie hochgeladen. Die Verwaltung (Admin) kann Excel-Dateien hochladen.</div>');
}
