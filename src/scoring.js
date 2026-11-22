// Punktelogik: exaktes Ergebnis = 2, richtige Tendenz = 1, sonst 0.

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function tendency(h, g) {
  return Math.sign(h - g); // 1 Heimsieg, 0 Unentschieden, -1 Auswärtssieg
}

/**
 * @param {{h:number,g:number}|null|undefined} tip
 * @param {{h:number,g:number}|null|undefined} result  null = Spiel noch nicht beendet
 * @returns {0|1|2}
 */
export function scoreMatch(tip, result) {
  if (!tip || !result) return 0;
  if (![tip.h, tip.g, result.h, result.g].every(isNum)) return 0;
  if (tip.h === result.h && tip.g === result.g) return 2;
  return tendency(tip.h, tip.g) === tendency(result.h, result.g) ? 1 : 0;
}

/**
 * Berechnet die Tabelle einer Halbserie.
 * @param {Array<{name:string,tips:Record<string,{h:number,g:number}>}>} players tips: matchKey -> Tipp
 * @param {Array<{key:string,spieltag:number,h:number,g:number}>} results nur beendete Spiele
 * @param {number[]} spieltage alle Spieltage der Halbserie
 */
export function buildTable(players, results, spieltage) {
  const byKey = new Map(results.map((r) => [r.key, r]));
  const chronikDays = new Set(); // Spieltage mit Daten aus einer Chronik-Halbserie
  const rows = players.map((p) => {
    if (p.perDay) { // Chronik: Punkte je Spieltag liegen schon vor, keine Einzeltipps
      const pd = Object.fromEntries(spieltage.map((d) => [d, p.perDay[d] ?? 0]));
      Object.keys(p.perDay).forEach((d) => chronikDays.add(Number(d)));
      return { name: p.name, perDay: pd, total: Object.values(pd).reduce((a, b) => a + b, 0), zwei: null, eins: null };
    }
    const perDay = Object.fromEntries(spieltage.map((d) => [d, 0]));
    let zwei = 0;
    let eins = 0;
    for (const [key, tip] of Object.entries(p.tips)) {
      const r = byKey.get(key);
      if (!r) continue;
      const pts = scoreMatch(tip, r);
      perDay[r.spieltag] = (perDay[r.spieltag] ?? 0) + pts;
      if (pts === 2) zwei++;
      else if (pts === 1) eins++;
    }
    const total = Object.values(perDay).reduce((a, b) => a + b, 0);
    return { name: p.name, perDay, total, zwei, eins };
  });
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'de'));
  // Rang mit Gleichständen (1,2,3,3,3,6 ...)
  rows.forEach((r, i) => {
    r.rank = i > 0 && rows[i - 1].total === r.total ? rows[i - 1].rank : i + 1;
  });
  const played = new Set([...results.map((r) => r.spieltag), ...chronikDays]).size;
  rows.forEach((r) => (r.schnitt = played ? r.total / played : 0));
  return rows;
}
