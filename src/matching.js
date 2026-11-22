// Zuordnung von Vereinsnamen (Excel -> aktuelle Bundesliga) und Erkennung möglicher Namens-Dubletten.
import { teamKey } from './teams.js';

const strip = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const teamWords = (s) => strip(s).replace(/[^a-z ]/g, ' ').split(/\s+/)
  .filter((w) => w && !['fc', 'sv', 'sc', 'vfl', 'vfb', 'tsg', 'fsv', 'bsc', 'borussia'].includes(w));

/**
 * Schlägt für einen Vereinsnamen aus der Datei einen aktuellen Bundesliga-Verein vor.
 * @returns {{suggestion: string|null, sure: boolean}} sure = Name stimmt bereits (oder über Alias) überein
 */
export function suggestTeam(name, bundesliga) {
  if (bundesliga.includes(name)) return { suggestion: name, sure: true };
  const key = teamKey(name);
  const byKey = bundesliga.find((t) => teamKey(t) === key);
  if (byKey) return { suggestion: byKey, sure: false }; // erkannt, aber anderer Name -> Umbenennung vorschlagen
  const w = teamWords(name).join(' ');
  if (w) {
    let best = null;
    for (const t of bundesliga) {
      const tw = teamWords(t).join(' ');
      const score = tw.includes(w) || w.includes(tw) ? 0 : lev(w, tw) / Math.max(w.length, tw.length);
      if (!best || score < best.score) best = { t, score };
    }
    if (best && best.score <= 0.25) return { suggestion: best.t, sure: false };
  }
  return { suggestion: null, sure: false };
}

/** Plan für die Rückfrage: je Vereinsname der Datei ein Vorschlag. */
export const planTeams = (excelTeams, bundesliga) =>
  excelTeams.map((name) => ({ name, ...suggestTeam(name, bundesliga) }));

/**
 * Findet Gruppen von Mitspielernamen, bei denen unklar ist, ob sie dieselbe Person sind
 * (gleicher Nachname, Tippfehler, nur Ziffern/Zusätze verschieden, Präfix).
 * @returns {string[][]} Gruppen mit ≥ 2 Namen
 */
export function findNameGroups(names) {
  const info = names.map((n) => {
    const base = strip(n);
    const sur = base.split(',')[0].replace(/[^a-z]/g, '');
    return { n, letters: base.replace(/[^a-z]/g, ''), sur };
  });
  const parent = info.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      const a = info[i], b = info[j];
      const similar = a.letters === b.letters
        || a.letters.startsWith(b.letters) || b.letters.startsWith(a.letters)
        || (a.sur && a.sur === b.sur)
        || (a.sur.length >= 4 && b.sur.length >= 4 && lev(a.sur, b.sur) <= 1);
      if (similar) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  info.forEach((x, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), x.n]));
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * Führt Spieler zusammen. `merges`: Liste { names: [...], into: 'Zielname' }.
 * Fehlende Tipps werden aus den anderen Blättern ergänzt, bei Widerspruch gewinnt das erste.
 */
export function mergePlayers(players, merges) {
  const byName = new Map(players.map((p) => [p.name, p]));
  const out = [];
  const used = new Set();
  const conflicts = [];
  for (const m of merges) {
    const parts = m.names.map((n) => byName.get(n)).filter(Boolean);
    if (parts.length < 2) continue;
    const tips = {};
    for (const p of parts) {
      for (const [k, t] of Object.entries(p.tips)) {
        if (!tips[k]) tips[k] = t;
        else if (tips[k].h !== t.h || tips[k].g !== t.g) conflicts.push(`${m.into}: abweichender Tipp bei ${k}`);
      }
      used.add(p.name);
    }
    out.push({ name: m.into, tips, matchCount: Math.max(...parts.map((p) => p.matchCount)), tipCount: Object.keys(tips).length });
  }
  return { players: [...players.filter((p) => !used.has(p.name)), ...out], conflicts };
}
