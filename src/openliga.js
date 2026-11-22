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
      kickoff: kickoffMs(m),
      // Zwischenstand laufender Spiele: Stand nach dem letzten Tor (ohne Tor 0:0)
      ...liveScore(m),
    };
  });
}

function kickoffMs(m) {
  const t = Date.parse(m.matchDateTimeUTC ?? m.matchDateTime ?? '');
  return Number.isFinite(t) ? t : null;
}

function liveScore(m) {
  const goals = [...(m.goals ?? [])].sort((a, b) => (a.goalID ?? 0) - (b.goalID ?? 0));
  const last = goals[goals.length - 1];
  return { lh: last?.scoreTeam1 ?? 0, lg: last?.scoreTeam2 ?? 0 };
}

/**
 * Zustand eines Spiels zum Zeitpunkt `now`: 'done' (Endstand steht), 'live' (Anstoß war, noch nicht beendet),
 * sonst 'pending'.
 */
export function matchState(m, now = Date.now()) {
  if (m.finished) return 'done';
  return m.kickoff != null && m.kickoff <= now ? 'live' : 'pending';
}

const NACHHOL_MS = 4 * 24 * 3600 * 1000;

/**
 * Der Spieltag, der gerade läuft: mindestens ein Spiel hat begonnen oder ist beendet und mindestens ein Spiel steht noch aus
 * (läuft oder beginnt innerhalb von 4 Tagen – weit verschobene Nachholspiele zählen nicht). Bei mehreren der höchste.
 * @param {Array} matches Spiele der Halbserie (mit spieltag, finished, kickoff)
 * @returns {number|null}
 */
export function currentSpieltag(matches, now = Date.now()) {
  const byDay = new Map();
  for (const m of matches) byDay.set(m.spieltag, [...(byDay.get(m.spieltag) ?? []), m]);
  let cur = null;
  for (const [day, ms] of byDay) {
    const st = ms.map((m) => matchState(m, now));
    const unfinished = ms.filter((_, i) => st[i] !== 'done');
    if (!unfinished.length || st.every((s) => s === 'pending')) continue;
    const lastStart = Math.max(...ms.filter((_, i) => st[i] !== 'pending').map((m) => m.kickoff ?? 0));
    const open = unfinished.some((m, i) => matchState(m, now) === 'live' || (m.kickoff ?? Infinity) - lastStart <= NACHHOL_MS);
    if (open && (cur === null || day > cur)) cur = day;
  }
  return cur;
}

/** Soll die Seite jede Minute aktualisieren? Bei laufendem Spieltag oder wenn in der nächsten Stunde ein Spiel beginnt. */
export function needsPolling(matches, now = Date.now()) {
  if (currentSpieltag(matches, now) !== null) return true;
  return matches.some((m) => !m.finished && m.kickoff != null && m.kickoff > now && m.kickoff - now <= 3600e3);
}

export async function fetchSeason(jahr, liga = 'bl1') {
  const res = await fetch(`${BASE}/${liga}/${jahr}`);
  if (!res.ok) throw new Error(`OpenLigaDB: HTTP ${res.status}`);
  return mapMatches(await res.json());
}

/** Aktuelle Bundesliga-Vereine der Saison (offizielle Namen). Wirft bei Fehler. */
export async function fetchTeams(jahr, liga = 'bl1') {
  const res = await fetch(`${BASE.replace('getmatchdata', 'getavailableteams')}/${liga}/${jahr}`);
  if (!res.ok) throw new Error(`OpenLigaDB: HTTP ${res.status}`);
  const names = (await res.json()).map((t) => t.teamName).filter(Boolean);
  if (!names.length) throw new Error('OpenLigaDB: keine Vereine');
  return names;
}
