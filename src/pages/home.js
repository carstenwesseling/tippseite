import { listRounds } from '../db.js';
import { esc } from '../util.js';

export async function renderHome(app) {
  const rounds = await listRounds();
  app.innerHTML = '<h1>Halbserien</h1>' + (rounds.length
    ? `<div class="rounds">${rounds.map((r) => `<a class="round" href="#/runde/${esc(r.id)}"><span><strong>${esc(r.title)}</strong>
        <span class="muted" style="display:block">${esc(r.typ === 'hin' ? 'Hinrunde' : 'Rückrunde')} · Saison ${esc(r.jahr)}/${String(+r.jahr + 1).slice(2)}</span></span>
        <span class="muted">${r.playerCount} Mitspieler</span></a>`).join('')}</div>`
    : '<div class="msg">Noch keine Halbserie hochgeladen. Die Verwaltung (Admin) kann Excel-Dateien hochladen.</div>');
}
