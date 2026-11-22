import { getRound, getSeasonMatches, listRounds } from '../db.js';
import { buildTable } from '../scoring.js';
import { resolveResults } from './table.js';
import { esc } from '../util.js';
import { normName } from '../halbserie.js';
import { computeOverview } from '../overview.js';
import { pointsCardHtml } from './punkte.js';

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
  const played = []; // { liga, rows } je Halbserie
  for (const round of full.filter(Boolean)) {
    const api = await loadSeason(round.jahr);
    const { spieltage, results } = resolveResults(round, api?.matches, { completeDaysOnly: true });
    played.push({ liga: round.liga ?? null, rows: buildTable(round.players, results, spieltage) });
  }
  // Liga 2 = Halbserien mit Liga 2; Liga 1 = alle übrigen (Liga 1 und Halbserien ohne Ligaangabe).
  const SCOPES = { l1: 'Liga 1', l2: 'Liga 2' };
  const inScope = (r, scope) => scope === 'l2' ? r.liga === 2 : r.liga !== 2;
  const aggregate = (scope) => {
    const agg = new Map();
    let n = 0;
    for (const r of played.filter((x) => inScope(x, scope))) {
      n++;
      for (const row of r.rows) {
        const k = normName(row.name);
        const a = agg.get(k) ?? { name: row.name, total: 0, teilnahmen: 0 };
        a.total += row.total;
        a.teilnahmen += 1;
        agg.set(k, a);
      }
    }
    return { list: [...agg.values()].map((a) => ({ ...a, schnitt: a.total / a.teilnahmen })), halbserien: n };
  };
  let scope = 'l1';
  let all = [];
  let nRounds = 0;
  const byName = (a, b) => a.name.localeCompare(b.name, 'de');
  const num = { schnitt: (r) => r.schnitt, total: (r) => r.total, teilnahmen: (r) => r.teilnahmen };
  // Rang nach dem gewählten Kriterium (beste = 1, Gleichstand = gleicher Rang); Gleichstände nach Schnitt, Punkten, Name.
  const rank = (key) => {
    const sorted = [...all].sort((a, b) => num[key](b) - num[key](a) || b.schnitt - a.schnitt || b.total - a.total || byName(a, b));
    sorted.forEach((r, i) => { r.rank = i > 0 && num[key](sorted[i - 1]) === num[key](r) ? sorted[i - 1].rank : i + 1; });
    return sorted;
  };
  const sort = { key: 'total', dir: 1 }; // Beim Aufruf nach Punkten sortiert und nummeriert
  let rankKey = 'total';

  const body = () => {
    const best = rank(rankKey);
    const rows = sort.key === 'name' ? [...all].sort(byName) : best;
    if (sort.dir < 0) rows.reverse();
    return rows;
  };
  const th = (key, cls, label) => `<th class="${cls} sortable" data-sort="${key}">${label}${sort.key === key ? (sort.dir > 0 === (key === 'name') ? ' ▲' : ' ▼') : ''}</th>`;
  const render = () => {
    ({ list: all, halbserien: nRounds } = aggregate(scope));
    const rows = body();
    app.innerHTML = `<div class="gut head"><div class="hl"><h1 class="plain">Bestenliste</h1>
    <div class="meta">${SCOPES[scope]} · ${nRounds} Halbserien · ${rows.length} Mitglieder</div></div>
    <div class="seg" role="group" aria-label="Liga">${Object.entries(SCOPES).map(([k, l]) => `<button data-scope="${k}" aria-pressed="${k === scope}">${l}</button>`).join('')}</div></div>
    ${rows.length ? `<div class="wrap"><table class="best-tbl"><thead><tr><th class="c1">#</th>${th('name', 'c2', 'Name')}
      ${th('teilnahmen', 'stat', 'Teilnahmen')}${th('schnitt', 'stat', 'Schnitt')}${th('total', 'ct', 'Pkt')}</tr></thead><tbody>${rows.map((r) => `
      <tr class="${r.rank <= 3 ? 'top' : ''}"><td class="c1"><span class="rk">${r.rank}</span></td><td class="c2"><a href="#/bestenliste/${encodeURIComponent(r.name)}">${esc(r.name)}</a></td>
      <td class="stat">${r.teilnahmen}</td><td class="stat">${fmt(r.schnitt)}</td><td class="ct">${r.total}</td></tr>`).join('')}</tbody></table></div>
      <div class="gut hint"><span>Schnitt = Gesamtpunkte ÷ Teilnahmen (Halbserien) · Nummerierung nach ${{ schnitt: 'Schnitt', total: 'Punkten', teilnahmen: 'Teilnahmen' }[rankKey]}; Klick auf eine Spaltenüberschrift sortiert neu, Klick auf einen Namen zeigt die Details</span></div>`
    : '<div class="msg">Noch keine Daten vorhanden.</div>'}`;
    app.querySelectorAll('button[data-scope]').forEach((b) => b.addEventListener('click', () => { scope = b.dataset.scope; render(); }));
    app.querySelectorAll('th[data-sort]').forEach((h) => h.addEventListener('click', () => {
      const key = h.dataset.sort;
      sort.dir = sort.key === key ? -sort.dir : 1; // erster Klick: beste zuerst bzw. Name A–Z
      sort.key = key;
      if (key !== 'name') rankKey = key; // Nummerierung folgt der Sortierung
      render();
    }));
  };
  render();
}

/** Detailansicht eines Mitglieds (öffentlich): Punkte und Rang in allen Halbserien, wie in der Mitgliederverwaltung. */
export async function renderBestenlisteMember(app, session, name) {
  const key = normName(name);
  const overview = await computeOverview(await listRounds(), { canWrite: session.isAdmin });
  const played = overview.map((o) => ({ o, row: o.table.find((r) => normName(r.name) === key) })).filter((x) => x.row);
  const shown = played[0]?.row.name ?? name;
  app.innerHTML = `<p class="back"><a href="#/bestenliste">← Bestenliste</a></p><h2 class="mname">${esc(shown)}</h2>${pointsCardHtml(played)}`;
}
