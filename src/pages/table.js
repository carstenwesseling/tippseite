import { getRound, getSeasonMatches } from '../db.js';
import { buildTable } from '../scoring.js';
import { esc, $ } from '../util.js';

/** Ergebnisse + Spieltage einer Halbserie aus API-Spielen ableiten (Fallback: Ergebnisse aus der Excel-Datei). */
export function resolveResults(round, apiMatches) {
  const byKey = new Map((apiMatches ?? []).map((m) => [m.key, m]));
  const inRound = round.order.map((o) => byKey.get(o.key)).filter(Boolean);
  if (inRound.length) {
    return {
      source: 'OpenLigaDB',
      spieltage: [...new Set(inRound.map((m) => m.spieltag))].sort((a, b) => a - b),
      results: inRound.filter((m) => m.finished).map((m) => ({ key: m.key, spieltag: m.spieltag, h: m.h, g: m.g })),
    };
  }
  const blocks = [...new Set(round.order.map((o) => o.block))].sort((a, b) => a - b);
  return {
    source: 'Excel-Datei (Fallback, Spieltag = Block)',
    spieltage: blocks,
    results: round.excelResults.map((r) => ({ key: r.key, spieltag: r.block, h: r.h, g: r.g })),
  };
}

export async function renderTable(app, session, id) {
  const round = await getRound(id);
  if (!round) { app.innerHTML = '<div class="msg err">Halbserie nicht gefunden.</div>'; return; }
  let api = null, info = '';
  try {
    api = await getSeasonMatches(round.jahr, { canWrite: session.isAdmin });
    info = `Ergebnisse: ${api.source}, Stand ${new Date(api.updatedAt).toLocaleString('de-DE')}`;
  } catch (e) {
    info = `OpenLigaDB nicht erreichbar (${e.message})`;
  }
  const { source, spieltage, results } = resolveResults(round, api?.matches);
  const table = buildTable(round.players, results, spieltage);
  const head = spieltage.map((d) => `<th>${d}</th>`).join('');
  app.innerHTML = `
    <h1>${esc(round.title)}</h1>
    <p class="muted">${esc(info)} · Quelle: ${esc(source)} · ${results.length} gewertete Spiele</p>
    <div class="scroll"><table>
      <thead><tr><th>Rang</th><th>Name</th>${head}<th>Gesamt</th><th>2er</th><th>1er</th><th>Ø</th></tr></thead>
      <tbody>${table.map((r) => `<tr><td>${r.rank}.</td><td>${esc(r.name)}</td>
        ${spieltage.map((d) => `<td>${r.perDay[d] ?? 0}</td>`).join('')}
        <td class="total">${r.total}</td><td>${r.zwei}</td><td>${r.eins}</td><td>${r.schnitt.toFixed(2)}</td></tr>`).join('')}</tbody>
    </table></div>`;
}
