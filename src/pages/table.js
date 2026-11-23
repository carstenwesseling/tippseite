import { getRound, getSeasonMatches, listRounds } from '../db.js';
import { buildTable } from '../scoring.js';
import { esc, $ } from '../util.js';
import { roundLabel, compareRounds } from '../halbserie.js';
import { matchState, currentSpieltag, needsPolling } from '../openliga.js';

/** Ergebnisse + Spieltage einer Halbserie aus API-Spielen ableiten (Fallback: Ergebnisse aus der Excel-Datei). */
export function resolveResults(round, apiMatches, { live = false, completeDaysOnly = false } = {}) {
  if (round.kind === 'chronik') { // Punkte je Spieltag stehen direkt bei den Spielern
    return { source: 'Chronik (Punkte je Spieltag)', spieltage: round.spieltage ?? [], results: [], matches: [] };
  }
  const byKey = new Map((apiMatches ?? []).map((m) => [m.key, m]));
  const inRound = round.order.map((o) => byKey.get(o.key)).filter(Boolean);
  if (inRound.length) {
    const out = {
      source: 'OpenLigaDB',
      spieltage: [...new Set(inRound.map((m) => m.spieltag))].sort((a, b) => a - b),
      // live: laufende Spiele zählen mit ihrem Zwischenstand (vorläufig), beendete mit dem Endstand
      results: inRound.flatMap((m) => {
        if (m.finished) return [{ key: m.key, spieltag: m.spieltag, h: m.h, g: m.g }];
        if (live && matchState(m) === 'live') return [{ key: m.key, spieltag: m.spieltag, h: m.lh ?? 0, g: m.lg ?? 0, live: true }];
        return [];
      }),
      matches: inRound,
    };
    if (completeDaysOnly) { // Bestenliste: erst nach einem vollständig beendeten Spieltag aktualisieren
      const open = new Set(inRound.filter((m) => !m.finished).map((m) => m.spieltag));
      out.results = out.results.filter((r) => !open.has(r.spieltag));
    }
    return out;
  }
  const blocks = [...new Set(round.order.map((o) => o.block))].sort((a, b) => a - b);
  return {
    source: 'Excel-Datei (Fallback, Spieltag = Block)',
    spieltage: blocks,
    results: round.excelResults.map((r) => ({ key: r.key, spieltag: r.block, h: r.h, g: r.g })),
    matches: [],
  };
}

const VIEW_KEY = 'tipp-ansicht';
const getView = () => { try { return localStorage.getItem(VIEW_KEY) === 'liste' ? 'liste' : 'tabelle'; } catch { return 'tabelle'; } };
const saveView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* optional */ } };

const isMe = (session, name) => {
  const first = (session.user?.displayName || '').split(' ')[0].toLowerCase();
  return Boolean(first) && name.toLowerCase() === first;
};

let pollTimer = null;
let pollToken = 0;
/** Beendet die automatische Aktualisierung (beim Seitenwechsel). */
export function stopPolling() { clearTimeout(pollTimer); pollTimer = null; pollToken++; }

const POLL_MS = 60 * 1000; // laufender Spieltag: jede Minute
const IDLE_MS = 5 * 60 * 1000; // Spiele stehen noch aus: nur die Anzeige neu bewerten

export async function renderTable(app, session, id) {
  stopPolling();
  const token = pollToken;
  const [round, rounds] = await Promise.all([getRound(id), listRounds().catch(() => [])]);
  if (!round) { app.innerHTML = '<div class="msg err">Halbserie nicht gefunden.</div>'; return; }
  let api = null, info = '';
  const load = async (live) => {
    try {
      api = await getSeasonMatches(round.jahr, { canWrite: session.isAdmin, live });
      info = `Ergebnisse: ${api.source}, Stand ${new Date(api.updatedAt).toLocaleString('de-DE')}`;
    } catch (e) {
      info = `OpenLigaDB nicht erreichbar (${e.message})`;
    }
  };
  if (round.kind !== 'chronik') await load(false);

  const sort = { key: 'rank', dir: 'asc' }; // bleibt bei automatischer Aktualisierung erhalten
  const draw = () => {
  const { source, spieltage, results, matches } = resolveResults(round, api?.matches, { live: true });
  const cur = currentSpieltag(matches); // Spieltag läuft: Spalte farbig markieren, bis das letzte Spiel beendet ist
  const liveCount = results.filter((r) => r.live).length;
  const table = buildTable(round.players, results, spieltage);

  const played = new Set(round.kind === 'chronik'
    ? round.players.flatMap((p) => Object.keys(p.perDay ?? {}).map(Number)) : results.map((r) => r.spieltag));
  const lastPlayed = played.size ? Math.max(...played) : null;
  const dayMax = Object.fromEntries(spieltage.map((d) => [d, played.has(d) ? Math.max(0, ...table.map((r) => r.perDay[d] ?? 0)) : -1]));
  const max = Math.max(1, ...Object.values(dayMax));
  const val = (r, d) => (played.has(d) ? (r.perDay[d] ?? 0) : null);
  // Alleiniger Spieltagssieger (nur ein Spieler mit der Höchstzahl) an einem abgeschlossenen Spieltag
  const dayDone = (d) => !(matches ?? []).some((m) => m.spieltag === d && !m.finished);
  const isSolo = (v, d) => v != null && v > 0 && v === dayMax[d] && dayDone(d) && d !== cur && table.filter((x) => (x.perDay[d] ?? 0) === dayMax[d]).length === 1;
  const isBest = (v, d) => v != null && v > 0 && v === dayMax[d];
  const stand = round.kind === 'chronik' ? 'Chronik' : api ? new Date(api.updatedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';
  const meta = round.kind === 'chronik'
    ? `Chronik · ${spieltage.length} Spieltage · ${round.players.length} Mitspieler`
    : lastPlayed
    ? `Stand ${stand} · ${results.length} Spiele · Spieltag ${lastPlayed} von ${Math.max(...spieltage)}${cur !== null ? ` · Spieltag ${cur} läuft${liveCount ? ` (${liveCount} live)` : ''}` : ''}`
    : `Stand ${stand} · noch keine Ergebnisse`;

  const options = [...(rounds.length ? rounds : [round])].sort(compareRounds).map((r) => `<option value="${esc(r.id)}"${r.id === id ? ' selected' : ''}>${esc(roundLabel(r))}</option>`).join('');

  // Sortierung per Klick auf die Spaltenüberschrift. Der Rang (linke Spalte) bleibt immer an den Punkten orientiert.
  const sortVal = (r, key) => {
    if (key === 'name') return r.name;
    if (key === 'rank') return -r.total;
    if (key === 'zwei' || key === 'eins' || key === 'total') return r[key] ?? -1;
    const v = val(r, Number(key.slice(1)));
    return v == null ? -1 : v;
  };
  const sortedRows = () => {
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...table].sort((a, b) => {
      const x = sortVal(a, sort.key), y = sortVal(b, sort.key);
      const c = typeof x === 'string' ? x.localeCompare(y, 'de') : x - y;
      return sign * c || b.total - a.total || a.name.localeCompare(b.name, 'de');
    });
  };
  const th = (key, label, cls) => {
    const on = sort.key === key;
    return `<th class="${cls}" data-sort="${key}" aria-sort="${on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" class="sortb" data-sort="${key}">${label}<span class="arr" aria-hidden="true">${on ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button></th>`;
  };
  const tableHtml = () => `<table><thead><tr>${th('rank', '#', 'c1')}${th('name', 'Name', 'c2')}${spieltage.map((d) => th(`d${d}`, d, `day${d === cur ? ' cur' : ''}`)).join('')}
    ${th('zwei', '2er', 'stat sep')}${th('eins', '1er', 'stat')}${th('total', 'Pkt', 'ct')}</tr></thead><tbody>${sortedRows().map((r) => `
    <tr class="${r.rank <= 3 ? 'top' : ''} ${isMe(session, r.name) ? 'me' : ''}"><td class="c1"><span class="rk">${r.rank}</span></td><td class="c2">${esc(r.name)}</td>
    ${spieltage.map((d) => { const v = val(r, d); const c = d === cur ? ' cur' : ''; return v == null ? `<td class="day pend${c}">${r.totalOnly ? '-' : '·'}</td>` : `<td class="day ${isSolo(v, d) ? 'solo' : isBest(v, d) ? 'best' : ''}${c}">${v}</td>`; }).join('')}
    <td class="stat sep">${r.zwei ?? '–'}</td><td class="stat">${r.eins ?? '–'}</td><td class="ct">${r.total}</td></tr>`).join('')}</tbody></table>`;

  const listHtml = table.map((r) => {
    const spark = spieltage.map((d) => { const v = val(r, d); const c = d === cur ? ' cur' : ''; return v == null ? `<span class="sc n${c}"><i></i><em></em></span>`
      : `<span class="sc ${isBest(v, d) ? 'b' : ''}${c}"><i style="height:${Math.max(2, v / max * 24)}px"></i><em>${v}</em></span>`; }).join('');
    const chart = spieltage.map((d) => { const v = val(r, d); const c = d === cur ? ' cur' : ''; return v == null ? `<div class="n${c}"><span>0</span><b></b></div>`
      : `<div class="${isBest(v, d) ? 'b' : ''}${c}"><span>${v}</span><b style="height:${Math.max(3, v / max * 64)}px"></b></div>`; }).join('');
    return `<div class="item ${isMe(session, r.name) ? 'me' : ''}" data-open="false">
      <button class="lrow" aria-expanded="false" style="padding-inline:max(16px,env(safe-area-inset-left,0px))">
        <span class="rank ${r.rank === 1 ? 'lead' : ''}">${r.rank}</span>
        <span class="who"><span class="nm">${esc(r.name)}</span><span class="spark" aria-hidden="true">${spark}</span></span>
        <span class="nums"><span><b>${r.zwei ?? '–'}</b> 2er</span><span><b>${r.eins ?? '–'}</b> 1er</span></span>
        <span class="pts">${r.total}</span>
      </button>
      <div class="detail gut"><div class="chart">${chart}</div>
        <div class="days">${spieltage.map((d) => `<div class="${d === cur ? 'cur' : ''}">${d}</div>`).join('')}</div>
        <div class="facts"><span><b>${r.zwei ?? '–'}</b>exakt (2 Pkt)</span><span><b>${r.eins ?? '–'}</b>Tendenz (1 Pkt)</span></div></div>
    </div>`;
  }).join('') + `<div class="gut lg"><span><i></i>Spieltagsbester (meiste Punkte am Spieltag)</span><span>Zahl unter dem Balken = Punkte</span>${cur !== null ? `<span><i class="curkey"></i>Spieltag ${cur} läuft – Punkte vorläufig</span>` : ''}</div>`;

  const prev = {
    open: [...app.querySelectorAll('.item')].map((el, i) => (el.dataset.open === 'true' ? i : -1)).filter((i) => i >= 0),
    left: app.querySelector('.wrap')?.scrollLeft ?? 0,
    top: window.scrollY,
  };
  app.innerHTML = `
    <div class="gut head">
      <div class="hl">
        <label class="title"><select id="round" aria-label="Halbserie wählen">${options}</select></label>
        <div class="meta">${esc(meta)}</div>
      </div>
      <div class="seg" role="group" aria-label="Ansicht"><button data-v="tabelle" aria-pressed="true">Tabelle</button><button data-v="liste" aria-pressed="false">Liste</button></div>
    </div>
    <section class="view" id="tabelle" aria-label="Tabelle">
      <div class="wrap" tabindex="0" aria-label="Tabelle, seitlich scrollbar">${tableHtml()}</div>
      <div class="gut hint"><span><i></i>Tagesbester</span><span><i class="solokey"></i>Alleiniger Spieltagssieger</span>${cur !== null ? `<span><i class="curkey"></i>Spieltag ${cur} läuft – Punkte vorläufig, Aktualisierung jede Minute</span>` : ''}<span>Seitlich wischen für alle Spieltage</span></div>
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
  app.querySelector('.wrap').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]'); if (!b) return;
    const key = b.dataset.sort;
    if (sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
    else { sort.key = key; sort.dir = key === 'name' || key === 'rank' ? 'asc' : 'desc'; }
    const wrap = e.currentTarget, left = wrap.scrollLeft;
    wrap.innerHTML = tableHtml();
    wrap.scrollLeft = left;
  });
  $('#round').addEventListener('change', (e) => { location.hash = `#/runde/${e.target.value}`; });
  $('#list').addEventListener('click', (e) => {
    const b = e.target.closest('.lrow'); if (!b) return;
    const it = b.parentElement, open = it.dataset.open !== 'true';
    it.dataset.open = open; b.setAttribute('aria-expanded', open);
  });
  // Zustand nach automatischer Aktualisierung wiederherstellen
  app.querySelectorAll('.item').forEach((el, i) => {
    if (prev.open.includes(i)) { el.dataset.open = 'true'; el.querySelector('.lrow').setAttribute('aria-expanded', 'true'); }
  });
  const wrap = app.querySelector('.wrap');
  if (wrap) wrap.scrollLeft = prev.left;
  window.scrollTo(0, prev.top);
  };

  draw();

  // Automatische Aktualisierung: bei laufendem Spieltag jede Minute neue Ergebnisse holen und Punkte neu berechnen.
  const schedule = () => {
    if (token !== pollToken || round.kind === 'chronik') return;
    const ms = resolveResults(round, api?.matches).matches;
    if (!ms.some((m) => !m.finished)) return; // alles beendet
    pollTimer = setTimeout(async () => {
      if (token !== pollToken) return;
      if (needsPolling(resolveResults(round, api?.matches).matches)) await load(true);
      if (token !== pollToken) return;
      draw();
      schedule();
    }, needsPolling(ms) ? POLL_MS : IDLE_MS);
  };
  schedule();
}
