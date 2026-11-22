import { listRounds, getTipping } from '../db.js';
import { esc } from '../util.js';

export async function renderHome(app) {
  const [rounds, tipping] = await Promise.all([listRounds(), getTipping().catch(() => null)]);
  const tippBanner = tipping?.open ? `<a class="round" href="#/tippen"><span><strong>${esc(tipping.title)}</strong><span class="muted" style="display:block">Die Tipprunde ist offen</span></span><span class="primary-link">Jetzt tippen</span></a>` : '';
  app.innerHTML = tippBanner + '<h1>Halbserien</h1>' + (rounds.length
    ? `<div class="rounds">${rounds.map((r) => `<a class="round" href="#/runde/${esc(r.id)}"><span><strong>${esc(r.title)}</strong>
        <span class="muted" style="display:block">${esc(r.typ === 'hin' ? 'Hinrunde' : 'Rückrunde')} · Saison ${esc(r.jahr)}/${String(+r.jahr + 1).slice(2)}</span></span>
        <span class="muted">${r.playerCount} Mitspieler</span></a>`).join('')}</div>`
    : '<div class="msg">Noch keine Halbserie hochgeladen. Die Verwaltung (Admin) kann Excel-Dateien hochladen.</div>');
}
