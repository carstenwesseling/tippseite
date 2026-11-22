import { getRound, getSeasonMatches, listRounds } from '../db.js';
import { buildTable } from '../scoring.js';
import { resolveResults } from './table.js';
import { esc } from '../util.js';
import { normName } from '../halbserie.js';

const fmt = (n) => n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Ewige Bestenliste: Gesamtpunkte und Schnitt je Teilnahme (Halbserie) über alle Halbserien. */
export async function renderBestenliste(app, session) {
  const rounds = await listRounds();
  const seasons = new Map();
  const loadSeason = (jahr) => {
    if (!seasons.has(jahr)) seasons.set(jahr, getSeasonMatches(jahr, { canWrite: session.isAdmin }).catch(() => null));
    return seasons.get(jahr);
  };
  const full = await Promise.all(rounds.map((r) => getRound(r.id)));
  const agg = new Map();
  for (const round of full.filter(Boolean)) {
    const api = await loadSeason(round.jahr);
    const { spieltage, results } = resolveResults(round, api?.matches);
    for (const row of buildTable(round.players, results, spieltage)) {
      const k = normName(row.name);
      const a = agg.get(k) ?? { name: row.name, total: 0, teilnahmen: 0 };
      a.total += row.total;
      a.teilnahmen += 1;
      agg.set(k, a);
    }
  }
  const rows = [...agg.values()].map((a) => ({ ...a, schnitt: a.total / a.teilnahmen }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'de'));
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].total === r.total ? rows[i - 1].rank : i + 1; });

  app.innerHTML = `<div class="gut head"><div class="hl"><h1 class="plain">Bestenliste</h1>
    <div class="meta">Alle Spieltage und Halbserien · ${full.length} Halbserien · ${rows.length} Mitglieder</div></div></div>
    ${rows.length ? `<div class="wrap"><table class="best-tbl"><thead><tr><th class="c1">#</th><th class="c2">Name</th>
      <th class="stat">Teilnahmen</th><th class="stat">Schnitt</th><th class="ct">Pkt</th></tr></thead><tbody>${rows.map((r) => `
      <tr class="${r.rank <= 3 ? 'top' : ''}"><td class="c1"><span class="rk">${r.rank}</span></td><td class="c2">${esc(r.name)}</td>
      <td class="stat">${r.teilnahmen}</td><td class="stat">${fmt(r.schnitt)}</td><td class="ct">${r.total}</td></tr>`).join('')}</tbody></table></div>
      <div class="gut hint"><span>Schnitt = Gesamtpunkte ÷ Teilnahmen (Halbserien)</span></div>`
    : '<div class="msg">Noch keine Daten vorhanden.</div>'}`;
}
