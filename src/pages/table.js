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

const VIEW_KEY = 'tipp-ansicht';
const getView = () => { try { return localStorage.getItem(VIEW_KEY) === 'liste' ? 'liste' : 'tabelle'; } catch { return 'tabelle'; } };
const saveView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* optional */ } };

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
  const max = Math.max(1, ...Object.values(dayMax));
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

  const listHtml = table.map((r) => {
    const spark = spieltage.map((d) => { const v = val(r, d); return v == null ? '<span class="sc n"><i></i><em></em></span>'
      : `<span class="sc ${isBest(v, d) ? 'b' : ''}"><i style="height:${Math.max(2, v / max * 24)}px"></i><em>${v}</em></span>`; }).join('');
    const chart = spieltage.map((d) => { const v = val(r, d); return v == null ? '<div class="n"><span>0</span><b></b></div>'
      : `<div class="${isBest(v, d) ? 'b' : ''}"><span>${v}</span><b style="height:${Math.max(3, v / max * 64)}px"></b></div>`; }).join('');
    return `<div class="item ${isMe(session, r.name) ? 'me' : ''}" data-open="false">
      <button class="lrow" aria-expanded="false" style="padding-inline:max(16px,env(safe-area-inset-left,0px))">
        <span class="rank ${r.rank === 1 ? 'lead' : ''}">${r.rank}</span>
        <span class="who"><span class="nm">${esc(r.name)}</span><span class="spark" aria-hidden="true">${spark}</span></span>
        <span class="nums"><span><b>${r.zwei}</b> 2er</span><span><b>${r.eins}</b> 1er</span><span>Ø <b>${r.schnitt.toFixed(1)}</b></span></span>
        <span class="pts">${r.total}</span>
      </button>
      <div class="detail gut"><div class="chart">${chart}</div>
        <div class="days">${spieltage.map((d) => `<div>${d}</div>`).join('')}</div>
        <div class="facts"><span><b>${r.zwei}</b>exakt (2 Pkt)</span><span><b>${r.eins}</b>Tendenz (1 Pkt)</span><span><b>${r.schnitt.toFixed(1)}</b>Ø je Spieltag</span></div></div>
    </div>`;
  }).join('') + `<div class="gut lg"><span><i></i>Spieltagsbester (meiste Punkte am Spieltag)</span><span>Zahl unter dem Balken = Punkte</span></div>`;

  app.innerHTML = `
    <div class="gut head">
      <div class="hl">
        <label class="title"><select id="round" aria-label="Halbserie wählen">${options}</select></label>
        <div class="meta">${esc(meta)}</div>
      </div>
      <div class="seg" role="group" aria-label="Ansicht"><button data-v="tabelle" aria-pressed="true">Tabelle</button><button data-v="liste" aria-pressed="false">Liste</button></div>
    </div>
    <section class="view" id="tabelle" aria-label="Tabelle">
      <div class="wrap" tabindex="0" aria-label="Tabelle, seitlich scrollbar">${tableHtml}</div>
      <div class="gut hint"><span><i></i>Tagesbester</span><span>Seitlich wischen für alle Spieltage</span></div>
    </section>
    <section class="view" id="liste" aria-label="Liste" hidden><div class="list" id="list">${listHtml}</div></section>
    <div class="gut foot">${esc(info)} · Quelle: ${esc(source)}</div>`;

  const setView = (v) => {
    app.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === v));
    $('#tabelle').hidden = v !== 'tabelle';
    $('#liste').hidden = v !== 'liste';
    saveView(v);
  };
  setView(getView());
  app.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v)));
  $('#round').addEventListener('change', (e) => { location.hash = `#/runde/${e.target.value}`; });
  $('#list').addEventListener('click', (e) => {
    const b = e.target.closest('.lrow'); if (!b) return;
    const it = b.parentElement, open = it.dataset.open !== 'true';
    it.dataset.open = open; b.setAttribute('aria-expanded', open);
  });
}
