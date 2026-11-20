import { getRound, getSeasonMatches, memberNames } from './db.js';
import { resolveResults } from './pages/table.js';
import { buildTable } from './scoring.js';
import { normName } from './halbserie.js';

/**
 * Berechnet für alle Halbserien die Tabellen (Ergebnisse aus dem Firestore-Cache bzw. OpenLigaDB).
 * @returns {Promise<Array<{round:object, spieltage:number[], table:object[], played:number}>>}
 */
export async function computeOverview(rounds, { canWrite = false } = {}) {
  const seasons = new Map(); // jahr -> Promise<matches|null>
  const matchesOf = (jahr) => {
    if (!seasons.has(jahr)) {
      seasons.set(jahr, getSeasonMatches(jahr, { canWrite }).then((r) => r.matches).catch(() => null));
    }
    return seasons.get(jahr);
  };
  return Promise.all(rounds.map(async (meta) => {
    const [round, matches] = await Promise.all([getRound(meta.id), matchesOf(meta.jahr)]);
    const { spieltage, results } = resolveResults(round, matches);
    return { round, spieltage, table: buildTable(round.players, results, spieltage), played: results.length };
  }));
}

/** Zeile eines Mitglieds in einer berechneten Tabelle (über Name oder Aliase) oder null. */
export function rowOfMember(member, table) {
  const names = new Set(memberNames(member));
  return table.find((r) => names.has(normName(r.name))) ?? null;
}
