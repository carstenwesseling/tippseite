import { getRound, getSeasonMatches } from '../db.js';
import { buildTable } from '../scoring.js';
import { esc } from '../util.js';
import { resolveResults } from './table.js';
import { gamesByDay } from '../spiele.js';

/** Hat der Spieler Einzeltipps (Chronik-Blätter haben nur Punkte je Spieltag bzw. nur eine Summe)? */
export const hasTips = (round, p) => round.kind !== 'chronik' && Boolean(p?.tips) && typeof p.total !== 'number' && !p.perDay;

export const spieleHref = (roundId, name, day) => `#/spiele/${encodeURIComponent(roundId)}/${encodeURIComponent(name)}/${day}`;

const sc = (x) => (x ? `${x.h}:${x.g}` : '–');
let lastDay = null; // zuletzt angesehener Einzel-Spieltag: dorthin führt der Schalter zurück

/** Seite "Spiele hinter den Punkten": Tipp neben dem echten Ergebnis, für einen Spieltag oder alle bisher gespielten. day = Spieltag oder "alle". */
export async function renderSpiele(app, session, roundId, name, day) {
  const round = await getRound(roundId);
  if (!round) { app.innerHTML = '<div class="msg err">Halbserie nicht gefunden.</div>'; return; }
  const back = `#/runde/${encodeURIComponent(roundId)}`;
  const player = round.players.find((p) => p.name === name);
  if (!player || !hasTips(round, player)) {
    app.innerHTML = `<a class="back" href="${back}">← Zur Tabelle</a><div class="msg">Für ${esc(name)} liegen in dieser Halbserie keine Einzeltipps vor.</div>`;
    return;
  }
  let api = null;
  try { api = await getSeasonMatches(round.jahr, { canWrite: session.isAdmin, live: true }); } catch { /* Fallback: Ergebnisse aus der Excel-Datei */ }
  const { spieltage, results, matches } = resolveResults(round, api?.matches, { live: true });
  const table = buildTable(round.players, results, spieltage);
  const row = table.find((r) => r.name === name);
  const all = gamesByDay(round, matches, results, player.tips);
  const dayMax = Object.fromEntries(all.map((g) => [g.day, Math.max(0, ...table.map((r) => r.perDay[g.day] ?? 0))]));
  const playedDays = all.map((g) => g.day);

  const showAll = day === 'alle';
  const dayNo = showAll ? null : Number(day);
  const groups = showAll ? all : all.filter((g) => g.day === dayNo);
  if (!groups.length) {
    app.innerHTML = `<a class="back" href="${back}">← Zur Tabelle</a><div class="msg">Für Spieltag ${esc(day)} gibt es noch keine Ergebnisse.</div>`;
    return;
  }
  if (!showAll) lastDay = dayNo;
  const sum = groups.reduce((a, g) => a + g.sum, 0);
  const live = groups.some((g) => g.live);
  const best = !showAll && groups[0].sum > 0 && groups[0].sum === dayMax[dayNo];

  const link = (n, d) => spieleHref(roundId, n, d);
  const idx = table.findIndex((r) => r.name === name);
  const near = (step) => { for (let i = idx + step; i >= 0 && i < table.length; i += step) if (hasTips(round, round.players.find((p) => p.name === table[i].name))) return table[i].name; return null; };
  const prevP = near(-1), nextP = near(1);
  const di = playedDays.indexOf(dayNo);
  const prevD = !showAll && di > 0 ? playedDays[di - 1] : null, nextD = !showAll && di >= 0 && di < playedDays.length - 1 ? playedDays[di + 1] : null;
  const toggleTo = showAll ? (lastDay && playedDays.includes(lastDay) ? lastDay : playedDays[playedDays.length - 1]) : 'alle';

  const pt = (r) => r.pts == null ? '<span class="sp-pt off"><i class="lb">offen</i></span>'
    : `<span class="sp-pt">${r.pts}<i class="lb"> ${r.pts === 2 ? 'exakt' : r.pts === 1 ? 'Tendenz' : 'daneben'}</i></span>`;
  const group = (g) => `<div class="sp-dh"><a href="${link(name, g.day)}" title="Nur diesen Spieltag ansehen">Spieltag ${g.day}</a>
      <span>${g.live ? 'läuft, vorläufig · ' : ''}${showAll && g.sum > 0 && g.sum === dayMax[g.day] ? '★ Tagesbester · ' : ''}<b>${g.sum}</b> Pkt</span></div>
    <div class="sp-ms"><div class="sp-mh" aria-hidden="true"><span style="text-align:right">Heim</span><span>Erg.</span><span style="text-align:left">Gast</span><span>Tipp</span><span>Pkt</span></div>
    ${g.rows.map((r) => `<div class="sp-m p${r.pts ?? 'x'}"><span class="h">${esc(r.home)}</span><span class="res" aria-label="Ergebnis">${r.res ? sc(r.res) : '–'}</span><span class="a">${esc(r.away)}</span>
      <span class="sp-tip" aria-label="Tipp">${sc(r.tip)}</span>${pt(r)}</div>`).join('')}</div>`;

  app.innerHTML = `<div class="sp">
    <a class="back" href="${back}" style="margin-inline:0">← Zur Tabelle</a>
    <div class="sp-hero"><div class="who"><h2>${esc(name)}</h2><span class="rank" title="Platz in der Tabelle">Platz ${row.rank}</span></div>
      <div class="what">${showAll ? `Alle bisher gespielten Spieltage (${playedDays.length})` : `Spieltag ${dayNo}`}${best ? ' · ★ Tagesbester' : ''}</div>
      <div class="big">${sum}<small>Punkte</small></div></div>
    <div class="sp-steps">
      ${showAll ? '' : `<div class="grp">${prevD ? `<a href="${link(name, prevD)}" aria-label="Spieltag ${prevD}">‹</a>` : '<span class="na" aria-hidden="true">‹</span>'}<span class="mid">Spieltag ${dayNo}</span>${nextD ? `<a href="${link(name, nextD)}" aria-label="Spieltag ${nextD}">›</a>` : '<span class="na" aria-hidden="true">›</span>'}</div>`}
      <button type="button" class="sp-tgl" id="sp-all" aria-pressed="${showAll}"><i></i>alle gespielten Spieltage</button></div>
    ${groups.map(group).join('')}
    <p class="sp-more" style="margin-top:12px">Punkte: <b>2</b> exakt · <b>1</b> richtige Tendenz · <b>0</b> daneben${live ? ' · laufende Spiele zählen mit dem Zwischenstand' : ''}</p>
    <div class="sp-pn"><a${prevP ? ` href="${link(prevP, showAll ? 'alle' : dayNo)}"` : ' class="na" aria-hidden="true"'}>${prevP ? `← ${esc(prevP)}` : '–'}</a><span class="lbl">Spieler</span><a${nextP ? ` href="${link(nextP, showAll ? 'alle' : dayNo)}"` : ' class="na" aria-hidden="true"'}>${nextP ? `${esc(nextP)} →` : '–'}</a></div>
  </div>`;
  app.querySelector('#sp-all').addEventListener('click', () => { location.hash = link(name, toggleTo); });
  window.scrollTo(0, 0);
}
