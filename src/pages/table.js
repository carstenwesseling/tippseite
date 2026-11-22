import { getRound, getSeasonMatches, listRounds } from '../db.js';
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
      // Tabelle wird erst nach einem vollständig beendeten Spieltag aktualisiert
      results: inRound.filter((m) => m.finished && inRound.filter((x) => x.spieltag === m.spieltag).every((x) => x.finished)).map((m) => ({ key: m.key, spieltag: m.spieltag, h: m.h, g: m.g })),
    };
  }
  const blocks = [...new Set(round.order.map((o) => o.block))].sort((a, b) => a - b);
  return {
    source: 'Excel-Datei (Fallback, Spieltag = Block)',
    spieltage: blocks,
    results: round.excelResults.map((r) => ({ key: r.key, spieltag: r.block, h: r.h, g: r.g })),
  };
}

const isMe = (session, name) => {
  const first = (session.user?.displayName || '').split(' ')[0].toLowerCase();
  return Boolean(first) && name.toLowerCase() === first;
};

export async function renderTable(app, session, id) {
  const [round, rounds] = await Promise.all([getRound(id), listRounds().catch(() => [])]);
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

  const played = new Set(results.map((r) => r.spieltag));
  const lastPlayed = played.size ? Math.max(...played) : null;
  const dayMax = Object.fromEntries(spieltage.map((d) => [d, played.has(d) ? Math.max(0, ...table.map((r) => r.perDay[d] ?? 0)) : -1]));
  const val = (r, d) => (played.has(d) ? (r.perDay[d] ?? 0) : null);
  const isBest = (v, d) => v != null && v > 0 && v === dayMax[d];
  const stand = api ? new Date(api.updatedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';
  const meta = lastPlayed
    ? `Stand ${stand} · ${results.length} Spiele · Spieltag ${lastPlayed} von ${Math.max(...spieltage)}`
    : `Stand ${stand} · noch keine Ergebnisse`;

  const options = (rounds.length ? rounds : [round]).map((r) => `<option value="${esc(r.id)}"${r.id === id ? ' selected' : ''}>${esc(r.title)}</option>`).join('');

  const tableHtml = `<table><thead><tr><th class="c1">#</th><th class="c2">Name</th>${spieltage.map((d) => `<th class="day">${d}</th>`).join('')}
    <th class="stat sep">2er</th><th class="stat">1er</th><th class="stat">Ø</th><th class="ct">Pkt</th></tr></thead><tbody>${table.map((r) => `
    <tr class="${r.rank <= 3 ? 'top' : ''} ${isMe(session, r.name) ? 'me' : ''}"><td class="c1"><span class="rk">${r.rank}</span></td><td class="c2">${esc(r.name)}</td>
    ${spieltage.map((d) => { const v = val(r, d); return v == null ? '<td class="day pend">·</td>' : `<td class="day ${isBest(v, d) ? 'best' : ''}">${v}</td>`; }).join('')}
    <td class="stat sep">${r.zwei}</td><td class="stat">${r.eins}</td><td class="stat">${r.schnitt.toFixed(1)}</td><td class="ct">${r.total}</td></tr>`).join('')}</tbody></table>`;

  app.innerHTML = `
    <div class="gut head">
      <div class="hl">
        <label class="title"><select id="round" aria-label="Halbserie wählen">${options}</select></label>
        <div class="meta">${esc(meta)}</div>
      </div>
    </div>
    <section class="view" id="tabelle" aria-label="Tabelle">
      <div class="wrap" tabindex="0" aria-label="Tabelle, seitlich scrollbar">${tableHtml}</div>
      <div class="gut hint"><span><i></i>Tagesbester</span><span>Seitlich wischen für alle Spieltage</span></div>
    </section>
    <div class="gut foot">${esc(info)} · Quelle: ${esc(source)}</div>`;

  $('#round').addEventListener('change', (e) => { location.hash = `#/runde/${e.target.value}`; });
}
