// Benennung und Erkennung von Halbserien: "25/26 H" = Hinrunde, "22/23 R" = Rückrunde der Saison.

const EXT = /\.(xlsx|xlsm|xlsb|xls|ods|csv)$/i;
export const stripExt = (name) => String(name).replace(EXT, '');

const yy = (n) => String(n).slice(-2).padStart(2, '0');

/** 2025 -> "25/26" */
export const seasonShort = (jahr) => `${yy(jahr)}/${yy(+jahr + 1)}`;
/** 2025 -> "2025/26" */
export const seasonLong = (jahr) => `${jahr}/${yy(+jahr + 1)}`;
export const typLabel = (typ) => (typ === 'hin' ? 'Hinrunde' : 'Rückrunde');
/** Kurzname, z. B. "25/26 H" */
export const roundCode = (r) => `${seasonShort(r.jahr)} ${r.typ === 'hin' ? 'H' : 'R'}${r.liga ? ` L${r.liga}` : ''}`;
/** Anzeige in Listen, z. B. "2025/26 · Rückrunde" */
export const roundLabel = (r) => `${seasonLong(r.jahr)} · ${typLabel(r.typ)}${r.liga ? ` · Liga ${r.liga}` : ''}`;
/** Eine Halbserie ist durch Saison, Hin-/Rückrunde und Liga bestimmt (Liga 1 und Liga 2 derselben Halbserie sind verschieden). */
export const sameHalbserie = (a, b) => a.jahr === b.jahr && a.typ === b.typ && (a.liga ?? null) === (b.liga ?? null);
/** Sortierung: neueste Saison zuerst, innerhalb der Saison Rückrunde vor Hinrunde. */
export const compareRounds = (a, b) =>
  b.jahr - a.jahr || (a.typ === b.typ ? 0 : a.typ === 'rueck' ? -1 : 1) || (a.liga ?? 0) - (b.liga ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0);

const toYear = (a) => (a >= 70 ? 1900 + a : 2000 + a);
const SEP = String.raw`\s*[\/\-_.–]\s*`;

// Die Muster werden sowohl zum Erkennen als auch zum Entfernen aus dem Dateinamen genutzt.
const SEASON_PATTERNS = [
  // 2025/26, 2025-2026, 2025_26
  { re: new RegExp(String.raw`(?<!\d)(20\d{2})${SEP}(?:20)?(\d{2})(?!\d)`, 'g'), year: (m) => (+m[1] + 1) % 100 === +m[2] ? +m[1] : null },
  // 25/26, 25-26, 25_26
  { re: new RegExp(String.raw`(?<!\d)(\d{2})${SEP}(\d{2})(?!\d)`, 'g'), year: (m) => (+m[1] + 1) % 100 === +m[2] ? toYear(+m[1]) : null },
  // 202526
  { re: /(?<!\d)(20\d{2})(\d{2})(?!\d)/g, year: (m) => (+m[1] + 1) % 100 === +m[2] ? +m[1] : null },
  // 2526
  { re: /(?<!\d)(\d{2})(\d{2})(?!\d)/g, year: (m) => (+m[1] + 1) % 100 === +m[2] ? toYear(+m[1]) : null },
];
const SINGLE_YEAR = /(?<!\d)(20\d{2})(?!\d)/g;

const RUECK = /r(?:ü|ue)ck(?:runde|serie|r|halb)?|2\.?\s*halb(?:serie|jahr)?/g;
const HIN = /hin(?:runde|serie|r)(?![a-zäöüß])|(?<![a-zäöüß])hin(?![a-zäöüß])|1\.?\s*halb(?:serie|jahr)?/g;
// Einzelbuchstabe nur als eigenes Wort (Leerzeichen, _ oder - drumherum) – "Müller,R." zählt nicht.
const LETTER = (c) => new RegExp(String.raw`(?<=^|[\s_\-])${c}(?=$|[\s_\-])`, 'g');
const H_ONLY = LETTER('h');
const R_ONLY = LETTER('r');

function findSeason(s) {
  for (const { re, year } of SEASON_PATTERNS) {
    for (const m of s.matchAll(re)) {
      const y = year(m);
      if (y) return y;
    }
  }
  return null;
}

function findTyp(s, hasSeason) {
  const rueck = new RegExp(RUECK).test(s);
  const hin = new RegExp(HIN).test(s);
  if (rueck !== hin) return rueck ? 'rueck' : 'hin';
  if (rueck && hin) return null;
  if (!hasSeason) return null;
  const r = new RegExp(R_ONLY).test(s);
  const h = new RegExp(H_ONLY).test(s);
  if (r !== h) return r ? 'rueck' : 'hin';
  return null;
}

/**
 * Ermittelt Saison (Startjahr) und Typ aus einem Dateinamen.
 * Beispiele: "rueckrunde2526.xlsm", "Tipps Hinrunde 22-23", "25_26_R", "Rückrunde 2026".
 * @returns {{jahr:number|null, typ:'hin'|'rueck'|null}}
 */
export function detectHalbserie(filename) {
  const s = stripExt(filename).toLowerCase();
  let jahr = findSeason(s);
  const typ = findTyp(s, jahr !== null);
  if (jahr === null && typ) {
    const m = [...s.matchAll(SINGLE_YEAR)][0];
    if (m) jahr = typ === 'rueck' ? +m[1] - 1 : +m[1]; // Rückrunde 2026 -> Saison 2025/26
  }
  return { jahr, typ };
}

/** Spielername aus dem Dateinamen: Saison-/Rundenangaben entfernen. "Wesseling,C. 25_26 R.xlsx" -> "Wesseling,C." */
export function nameFromFilename(filename) {
  let s = stripExt(filename);
  for (const { re } of SEASON_PATTERNS) s = s.replace(re, ' ');
  s = s.replace(SINGLE_YEAR, ' ').replace(/_/g, ' ');
  s = s.replace(new RegExp(RUECK.source, 'gi'), ' ').replace(new RegExp(HIN.source, 'gi'), ' ');
  s = s.replace(/tippspiel|tipps?|halbserie/gi, ' ');
  s = s.replace(new RegExp(H_ONLY.source, 'gi'), ' ').replace(new RegExp(R_ONLY.source, 'gi'), ' ');
  return s.replace(/\s+/g, ' ').replace(/^[\s\-–]+|[\s\-–]+$/g, '').trim();
}

/** Standardnamen, die Excel neuen Blättern gibt – dann ist der Dateiname der bessere Spielername. */
export const isGenericSheetName = (name) => /^(tabelle|sheet|blatt|table|tipps?|tippschein)\s*\d*$/i.test(String(name).trim());

/** Schlüssel für den Namensvergleich: Groß-/Kleinschreibung, Leerzeichen und "Name, V." = "Name,V." egal. */
export const normName = (n) => String(n ?? '').normalize('NFC').toLowerCase().replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim();
