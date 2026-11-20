import { listRounds } from '../db.js';
import { esc } from '../util.js';

export async function renderHome(app) {
  const rounds = await listRounds();
  app.innerHTML = `<h1>Halbserien</h1>` + (rounds.length
    ? rounds.map((r) => `<div class="card"><a href="#/runde/${esc(r.id)}"><strong>${esc(r.title)}</strong></a>
        <div class="muted">${esc(r.typ === 'hin' ? 'Hinrunde' : 'Rückrunde')} · Saison ${esc(r.jahr)}/${String(+r.jahr + 1).slice(2)} · ${r.playerCount} Mitspieler</div></div>`).join('')
    : '<div class="msg">Noch keine Halbserie hochgeladen. Die Verwaltung (Admin) kann Excel-Dateien hochladen.</div>');
}
