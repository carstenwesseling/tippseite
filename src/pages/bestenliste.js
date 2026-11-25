import { listRounds, saveRoundSummary } from '../db.js';
import { esc } from '../util.js';
import { normName, samePerson } from '../halbserie.js';
import { computeOverview, computeSummary } from '../overview.js';
import { pointsCardHtml } from './punkte.js';

const fmt = (n) => n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Ewige Bestenliste: Gesamtpunkte und Schnitt je Teilnahme (Halbserie) über alle Halbserien. */
export async function renderBestenliste(app, session) {
  const rounds = await listRounds();
  // Abgeschlossene Halbserien tragen ihre fertige Tabelle (`summary`) im Dokument: dann sind keine weiteren Lesezugriffe nötig.
  // Fehlt sie (neue Halbserie), wird sie berechnet und – als Admin – gespeichert; alle gleichzeitig.
  const played = (await Promise.all(rounds.map(async (meta) => {
    let rows = meta.summary?.map((x) => ({ name: x.n, total: x.t, rank: x.r }));
    if (!rows) {
      rows = await computeSummary(meta, { canWrite: session.isAdmin }); // null = noch nicht abgeschlossen
      if (rows && session.isAdmin) saveRoundSummary(meta.id, rows).catch(() => {});
    }
    return rows ? { liga: meta.liga ?? null, jahr: meta.jahr, rows } : null;
  }))).filter(Boolean); // { liga, jahr, rows } je abgeschlossener Halbserie
  // Liga 2 = Halbserien mit Liga 2; Liga 1 = alle übrigen (Liga 1 und Halbserien ohne Ligaangabe).
  const SCOPES = { l1: 'Liga 1', l2: 'Liga 2' };
  const inScope = (r, scope) => scope === 'l2' ? r.liga === 2 : r.liga !== 2;
  const aggregate = (scope) => {
    const agg = new Map();
    let n = 0;
    for (const r of played.filter((x) => inScope(x, scope) && x.jahr >= range.von && x.jahr <= range.bis)) {
      n++;
      for (const row of r.rows) {
        const k = normName(row.name);
        const a = agg.get(k) ?? { name: row.name, total: 0, teilnahmen: 0, p1: 0, p2: 0, p3: 0 };
        a.total += row.total;
        a.teilnahmen += 1;
        if (row.rank >= 1 && row.rank <= 3) a[`p${row.rank}`] += 1; // Platz in der Halbserie (Gleichstand = gleicher Platz)
        agg.set(k, a);
      }
    }
    return { list: [...agg.values()].map((a) => ({ ...a, schnitt: a.total / a.teilnahmen })), halbserien: n };
  };
  let scope = 'l1';
  const range = { von: -Infinity, bis: Infinity }; // Zeitraum nach Saison (Startjahr)
  let topN = 15; // Anzahl Mitglieder in den Balkendiagrammen
  const saison = (y) => `${y}/${String(y + 1).slice(2)}`;
  const MAXMIN = 10; // Schnitt-Ranking: mind. so viele Teilnahmen (bei kurzen Zeiträumen weniger)
  const bars = (rows, val, text, lo) => {
    const hi = Math.max(...rows.map(val), 0);
    const w = (r) => (hi > lo ? Math.max(2, ((val(r) - lo) / (hi - lo)) * 100) : 100);
    return `<div class="hb">${rows.map((r) => `<a class="hb-r" href="#/bestenliste/${encodeURIComponent(r.name)}"><span class="hb-n">${esc(r.name)}</span><span class="hb-t"><i style="width:${w(r).toFixed(1)}%"></i></span><b>${text(r)}</b></a>`).join('')}</div>`;
  };
  let all = [];
  let nRounds = 0;
  const byName = (a, b) => a.name.localeCompare(b.name, 'de');
  const num = { schnitt: (r) => r.schnitt, total: (r) => r.total, teilnahmen: (r) => r.teilnahmen, p1: (r) => r.p1, p2: (r) => r.p2, p3: (r) => r.p3 };
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
    const years = [...new Set(played.filter((x) => inScope(x, scope)).map((x) => x.jahr))].sort((a, b) => a - b);
    const opt = (cur) => years.map((y) => `<option value="${y}"${y === cur ? ' selected' : ''}>${saison(y)}</option>`).join('');
    const von = years.includes(range.von) ? range.von : years[0];
    const bis = years.includes(range.bis) ? range.bis : years[years.length - 1];
    const minT = Math.min(MAXMIN, Math.max(1, Math.ceil(nRounds / 2)));
    const byPts = [...all].sort((a, b) => b.total - a.total || b.schnitt - a.schnitt || byName(a, b)).slice(0, topN);
    const bySchnitt = all.filter((r) => r.teilnahmen >= minT).sort((a, b) => b.schnitt - a.schnitt || b.total - a.total || byName(a, b)).slice(0, topN);
    const charts = rows.length ? `<div class="gut bctl"><label>Zeitraum von <select data-range="von">${opt(von)}</select></label><label>bis <select data-range="bis">${opt(bis)}</select></label>
      <label>Anzeige <select data-topn>${[[10, 'Top 10'], [15, 'Top 15'], [25, 'Top 25'], [50, 'Top 50'], [9999, 'Alle']].map(([v, l]) => `<option value="${v}"${v === topN ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="gut bcharts"><section><h2>Meiste Punkte</h2>${bars(byPts, (r) => r.total, (r) => r.total, 0)}</section>
      <section><h2>Bester Schnitt <small>ab ${minT} Teilnahmen</small></h2>${bars(bySchnitt, (r) => r.schnitt, (r) => fmt(r.schnitt), Math.floor(Math.min(...bySchnitt.map((r) => r.schnitt)) - 2))}</section></div>` : '';
    app.innerHTML = `<div class="gut head"><div class="hl"><h1 class="plain">Bestenliste</h1>
    <div class="meta">${SCOPES[scope]}${years.length ? ` · ${saison(von)}–${saison(bis)}` : ''} · ${nRounds} Halbserien · ${rows.length} Mitglieder</div></div>
    <div class="seg" role="group" aria-label="Liga">${Object.entries(SCOPES).map(([k, l]) => `<button data-scope="${k}" aria-pressed="${k === scope}">${l}</button>`).join('')}</div></div>
    ${charts}
    ${rows.length ? `<div class="wrap"><table class="best-tbl"><thead><tr><th class="c1">#</th>${th('name', 'c2', 'Name')}
      ${th('p1', 'stat', '1. Plätze')}${th('p2', 'stat', '2. Plätze')}${th('p3', 'stat', '3. Plätze')}${th('teilnahmen', 'stat', 'Teilnahmen')}${th('schnitt', 'stat', 'Schnitt')}${th('total', 'ct', 'Pkt')}</tr></thead><tbody>${rows.map((r) => `
      <tr class="${r.rank <= 3 ? 'top' : ''}"><td class="c1"><span class="rk">${r.rank}</span></td><td class="c2"><a href="#/bestenliste/${encodeURIComponent(r.name)}">${esc(r.name)}</a></td>
      <td class="stat">${r.p1}</td><td class="stat">${r.p2}</td><td class="stat">${r.p3}</td><td class="stat">${r.teilnahmen}</td><td class="stat">${fmt(r.schnitt)}</td><td class="ct">${r.total}</td></tr>`).join('')}</tbody></table></div>
      <div class="gut hint"><span>Schnitt = Gesamtpunkte ÷ Teilnahmen (Halbserien) · Plätze = Platzierungen über alle abgeschlossenen Halbserien der Liga (Gleichstand = gleicher Platz) · Nummerierung nach ${{ schnitt: 'Schnitt', total: 'Punkten', teilnahmen: 'Teilnahmen', p1: '1. Plätzen', p2: '2. Plätzen', p3: '3. Plätzen' }[rankKey]}; Klick auf eine Spaltenüberschrift sortiert neu, Klick auf einen Namen zeigt die Details</span></div>`
    : '<div class="msg">Noch keine Daten vorhanden.</div>'}`;
    app.querySelectorAll('button[data-scope]').forEach((b) => b.addEventListener('click', () => { scope = b.dataset.scope; render(); }));
    app.querySelectorAll('select[data-range]').forEach((sel) => sel.addEventListener('change', () => {
      range.von = +app.querySelector('select[data-range="von"]').value; range.bis = +app.querySelector('select[data-range="bis"]').value;
      if (range.von > range.bis) { if (sel.dataset.range === 'von') range.bis = range.von; else range.von = range.bis; }
      render();
    }));
    app.querySelector('select[data-topn]')?.addEventListener('change', (e) => { topN = +e.target.value; render(); });
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
  const key = normName(samePerson(name));
  const overview = await computeOverview(await listRounds(), { canWrite: session.isAdmin });
  const played = overview.filter((o) => o.complete).map((o) => ({ o, row: o.table.find((r) => normName(r.name) === key) })).filter((x) => x.row);
  const shown = played[0]?.row.name ?? name;
  app.innerHTML = `<p class="back"><a href="#/bestenliste">← Bestenliste</a></p><h2 class="mname">${esc(shown)}</h2>${pointsCardHtml(played)}`;
}
