// Spiele hinter den Punkten: Tipp und echtes Ergebnis je Spiel, gruppiert nach Spieltag.
import { scoreMatch } from './scoring.js';
import { shortName } from './teams.js';

/**
 * @param {{order:Array<{key:string,home?:string,away?:string,block?:number}>}} round
 * @param {Array} matches Spiele der Halbserie von OpenLigaDB (leer bei Excel-Fallback)
 * @param {Array<{key:string,spieltag:number,h:number,g:number,live?:boolean}>} results beendete (und laufende) Spiele
 * @param {Record<string,{h:number,g:number}>} tips Tipps des Spielers je Spielschlüssel
 * @returns {Array<{day:number,sum:number,z:number,e:number,n:number,live:boolean,open:number,rows:Array}>} nur Spieltage mit Ergebnissen, aufsteigend
 */
export function gamesByDay(round, matches, results, tips) {
  const res = new Map(results.map((r) => [r.key, r]));
  const api = new Map((matches ?? []).map((m) => [m.key, m]));
  const days = new Map();
  (round.order ?? []).forEach((o, i) => {
    const r = res.get(o.key), m = api.get(o.key);
    const day = r?.spieltag ?? m?.spieltag ?? o.block;
    if (day == null) return;
    const [kh, ka] = o.key.split('|');
    const tip = tips?.[o.key] ?? null;
    const row = {
      key: o.key, i, kickoff: m?.kickoff ?? null,
      home: shortName(m?.home ?? o.home ?? kh), away: shortName(m?.away ?? o.away ?? ka),
      res: r ? { h: r.h, g: r.g, live: Boolean(r.live) } : null,
      tip, pts: r ? scoreMatch(tip, r) : null,
    };
    days.set(day, [...(days.get(day) ?? []), row]);
  });
  const played = new Set(results.map((r) => r.spieltag));
  return [...days.entries()].filter(([d]) => played.has(d)).sort((a, b) => a[0] - b[0]).map(([day, rows]) => {
    rows.sort((a, b) => (a.kickoff ?? Infinity) - (b.kickoff ?? Infinity) || a.i - b.i);
    const done = rows.filter((r) => r.res);
    return {
      day, rows,
      sum: done.reduce((a, r) => a + r.pts, 0),
      z: done.filter((r) => r.pts === 2).length, e: done.filter((r) => r.pts === 1).length, n: done.filter((r) => r.pts === 0).length,
      live: done.some((r) => r.res.live), open: rows.length - done.length,
    };
  });
}
