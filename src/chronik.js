// Import einer "Chronik"-Datei: ein Blatt je abgeschlossener Halbserie, je Mitspieler eine Zeile mit
// den Punkten pro Spieltag. Nur die Spalten A–S werden gelesen (Platz, Name, Spieltage 1–17);
// alles rechts davon (Gesamt, 2er, Formeln) wird ignoriert, die Summe rechnen wir selbst.
import * as XLSX from 'xlsx';

export const LAST_COL = 18; // Spalte S (0-basiert)
const FIRST_DAY_COL = 2; // Spalte C

const SHEET_RE = /(hin|r(?:ü|ue)ck)runde\s*(\d{4})\s*[-/–]\s*(\d{2,4})\s*(?:l(\d))?/i;

/** "Hinrunde 2010-2011 L1" -> { typ:'hin', jahr:2010, liga:1 } oder null */
export function parseChronikSheetName(name) {
  const m = SHEET_RE.exec(String(name));
  if (!m) return null;
  return { typ: m[1].toLowerCase() === 'hin' ? 'hin' : 'rueck', jahr: Number(m[2]), liga: m[4] ? Number(m[4]) : null };
}

const cell = (ws, r, c) => ws[XLSX.utils.encode_cell({ r, c })]?.v;
const num = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return Number(v);
  return null; // "-" = nicht gewertet
};

/** Spieltagsspalten aus der Kopfzeile: fortlaufende Zahlen 1, 2, 3 … ab Spalte C (maximal bis S). */
function dayColumns(ws) {
  const cols = [];
  for (let c = FIRST_DAY_COL; c <= LAST_COL; c++) {
    const v = num(cell(ws, 0, c));
    if (v === cols.length + 1) cols.push(c);
    else break;
  }
  return cols;
}

/**
 * @returns {null | {rounds: Array<{sheet,jahr,typ,liga,spieltage:number[],players:Array<{name,perDay:Object}>}>, ignored:string[], warnings:string[]}}
 *   null, wenn die Datei kein Chronik-Format hat.
 */
export function parseChronik(data) {
  const wb = XLSX.read(data, { type: 'array', cellFormula: false, sheetRows: 400 });
  const rounds = [];
  const ignored = [];
  const warnings = [];
  for (const sheet of wb.SheetNames) {
    const meta = parseChronikSheetName(sheet);
    const ws = wb.Sheets[sheet];
    const cols = meta ? dayColumns(ws) : [];
    if (!meta || cols.length < 2) { ignored.push(sheet); continue; }
    const players = [];
    const seen = new Set();
    for (let r = 1; r < 400; r++) {
      const raw = cell(ws, r, 1);
      const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
      if (!name) break;
      if (seen.has(name)) { warnings.push(`Blatt "${sheet}": Name "${name}" kommt doppelt vor (2. Eintrag ignoriert).`); continue; }
      seen.add(name);
      const perDay = {};
      cols.forEach((c, i) => { const v = num(cell(ws, r, c)); if (v !== null) perDay[i + 1] = v; });
      players.push({ name, perDay });
    }
    if (!players.length) { ignored.push(sheet); continue; }
    rounds.push({ sheet, ...meta, spieltage: cols.map((_, i) => i + 1), players });
  }
  return rounds.length ? { rounds, ignored, warnings } : null;
}

/** Wendet eine Namenszuordnung (alt -> neu) an. Kollidieren zwei Namen im selben Blatt, bleibt der erste. */
export function renameChronik(rounds, map, warnings = []) {
  return rounds.map((rd) => {
    const out = [];
    const seen = new Set();
    for (const p of rd.players) {
      const name = map[p.name] ?? p.name;
      if (seen.has(name)) { warnings.push(`Blatt "${rd.sheet}": „${name}“ kommt nach dem Zusammenführen doppelt vor – nur der erste Eintrag zählt.`); continue; }
      seen.add(name);
      out.push({ ...p, name });
    }
    return { ...rd, players: out };
  });
}
