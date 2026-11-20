// Echte Ergebnisse von OpenLigaDB (https://www.openligadb.de), Liga "bl1" = 1. Bundesliga.
// Saison-Parameter = Startjahr, z. B. 2025 für 2025/26.
import { matchKey } from './teams.js';

const BASE = 'https://api.openligadb.de/getmatchdata';

/** Wandelt die API-Antwort in schlanke Spielobjekte um. Nur beendete Spiele haben h/g. */
export function mapMatches(apiMatches) {
  return apiMatches.map((m) => {
    const end = (m.matchResults ?? []).find((r) => r.resultTypeID === 2); // 2 = Endergebnis
    const finished = Boolean(m.matchIsFinished && end);
    return {
      key: matchKey(m.team1.teamName, m.team2.teamName),
      spieltag: m.group?.groupOrderID ?? 0,
      home: m.team1.teamName,
      away: m.team2.teamName,
      finished,
      h: finished ? end.pointsTeam1 : null,
      g: finished ? end.pointsTeam2 : null,
      date: m.matchDateTime ?? null,
    };
  });
}

export async function fetchSeason(jahr, liga = 'bl1') {
  const res = await fetch(`${BASE}/${liga}/${jahr}`);
  if (!res.ok) throw new Error(`OpenLigaDB: HTTP ${res.status}`);
  return mapMatches(await res.json());
}
