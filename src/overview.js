import { cached } from './cache.js';
import { getRound, getSeasonMatches, memberNames } from './db.js';
import { resolveResults } from './pages/table.js';
import { buildTable } from './scoring.js';
import { normName, samePerson } from './halbserie.js';

/** Halbserie samt Spielern; die Meta-Daten (Spielerzahl, Erstellzeit) sind Teil des Schlüssels. */
export const getRoundCached = (meta) => cached(`round:${meta.id}:${meta.playerCount ?? ''}:${meta.createdAt ?? ''}`, () => getRound(meta.id));
/** Spiele einer Saison (null, wenn nicht ladbar). */
export const getSeasonCached = (jahr, opts = {}) =>
  cached(`season:${jahr}:${opts.canWrite ? 'w' : 'r'}`, () => getSeasonMatches(jahr, opts).catch(() => null));

/**
 * Berechnet für alle Halbserien die Tabellen (Ergebnisse aus dem Firestore-Cache bzw. OpenLigaDB).
 * @returns {Promise<Array<{round:object, spieltage:number[], table:object[], played:number}>>}
 */
export async function computeOverview(rounds, { canWrite = false } = {}) {
  const matchesOf = (jahr) => getSeasonCached(jahr, { canWrite }).then((r) => r?.matches ?? null);
  return Promise.all(rounds.map(async (meta) => {
    const [round, matches] = await Promise.all([getRoundCached(meta), matchesOf(meta.jahr)]);
    const { spieltage, results, matches: roundMatches } = resolveResults(round, matches, { completeDaysOnly: true });
    return { round, spieltage, table: buildTable(round.players, results, spieltage), played: results.length, complete: roundMatches.every((m) => m.finished) };
  }));
}

/** Zeile eines Mitglieds in einer berechneten Tabelle (über Name oder Aliase) oder null. */
export function rowOfMember(member, table) {
  const names = new Set(memberNames(member).map((n) => normName(samePerson(n))));
  return table.find((r) => names.has(normName(r.name))) ?? null;
}
