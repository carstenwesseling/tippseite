import { listRounds, getTipping } from '../db.js';
import { esc } from '../util.js';
import { compareRounds } from '../halbserie.js';
import { renderTable } from './table.js';

/** Startseite: die aktuelle Halbserie ist immer aufgeklappt; andere Halbserien wählt man im Dropdown. */
export async function renderHome(app, session) {
  const [rounds, tipping] = await Promise.all([listRounds().then((r) => r.sort(compareRounds)), getTipping().catch(() => null)]);
  const banner = tipping?.open ? `<a class="round" href="#/tippen"><span><strong>${esc(tipping.title)}</strong>
    <span class="muted" style="display:block">Die Tipprunde ist offen</span></span><span>Jetzt tippen</span></a>` : '';
  if (rounds.length) {
    await renderTable(app, session, rounds[0].id);
    if (banner) app.insertAdjacentHTML('afterbegin', banner);
    return;
  }
  app.innerHTML = `${banner}<h1>Halbserien</h1><div class="msg">Noch keine Halbserie hochgeladen. Die Verwaltung (Admin) kann Excel-Dateien hochladen.</div>`;
}
