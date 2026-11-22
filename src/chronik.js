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
function dayColumns(ws, row = 0) {
  const cols = [];
  for (let c = FIRST_DAY_COL; c <= LAST_COL; c++) {
    const v = num(cell(ws, row, c));
    if (v === cols.length + 1) cols.push(c);
    else break;
  }
  return cols;
}

const colName = (c) => XLSX.utils.encode_col(c);
const nameOf = (raw) => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '');
const filled = (v) => num(v) !== null || (typeof v === 'string' && v.trim() === '-');
const dataCount = (ws, r) => { let n = 0; for (let c = FIRST_DAY_COL; c <= LAST_COL; c++) if (num(cell(ws, r, c)) !== null) n++; return n; };

const MAX_HEADER_ROW = 15;

/** Beschreibt, wie ein Blatt aufgebaut ist – unabhängig davon, ob die Kopfzeile in Zeile 1 steht. */
function inspectSheet(ws) {
  // Kopfzeile suchen: normalerweise Zeile 1; manchmal stehen Reste (Hilfszeilen) darüber.
  let headerRow = -1, headerCols = [];
  for (let h = 0; h <= MAX_HEADER_ROW; h++) {
    const cols = dayColumns(ws, h);
    if (cols.length >= 2) { headerRow = h; headerCols = cols; break; }
  }
  let start;
  if (headerRow >= 0) start = headerRow + 1;
  else { // gar keine Kopfzeile: erste Zeile mit Namen und mehreren Zahlen
    start = 1;
    for (let r = 0; r <= MAX_HEADER_ROW; r++) if (nameOf(cell(ws, r, 1)) && dataCount(ws, r) >= 3) { start = r; break; }
  }
  const rows = [];
  let r = start;
  for (; r < 400 && nameOf(cell(ws, r, 1)); r++) rows.push(r);
  // Spieler unterhalb einer Leerzeile (wird sonst nicht mehr gelesen)
  const extra = [];
  for (let k = r + 1; k < 400; k++) if (nameOf(cell(ws, k, 1)) && dataCount(ws, k) >= 1) extra.push(k);
  // Breite der tatsächlich gefüllten Spieltagsspalten (ab C, lückenlos, mind. die Hälfte der Spieler)
  let dayRun = 0;
  for (let c = FIRST_DAY_COL; c <= LAST_COL; c++) {
    const n = rows.filter((x) => filled(cell(ws, x, c))).length;
    if (rows.length && n >= Math.ceil(rows.length / 2)) dayRun++;
    else break;
  }
  return { headerRow, headerCols, start, rows, extra, dayRun };
}

/** Prüft die Gesamt-Spalte (T) gegen die Summe der gelesenen Spieltage; nur zur Information. */
function sumCheck(ws, rows, cols) {
  let ok = 0, total = 0;
  for (const r of rows) {
    const t = num(cell(ws, r, LAST_COL + 1));
    if (t === null) continue;
    total++;
    if (cols.reduce((s, c) => s + (num(cell(ws, r, c)) ?? 0), 0) === t) ok++;
  }
  return total ? ` Kontrolle: Die Gesamt-Spalte stimmt bei ${ok} von ${total} Spielern mit der Summe überein.` : '';
}

const FIXES = {
  headerrow: 'Zeilen über der Kopfzeile ignorieren',
  positional: 'Spieltage nach Spaltenposition lesen',
  totals: 'Nur Gesamtpunkte importieren',
  skipblank: 'Leerzeilen überspringen',
};
export const FIX_LABELS = FIXES;

/**
 * @param {ArrayBuffer|Uint8Array} data
 * @param {{fixes?: Object<string,string|string[]>}} [opts] Korrekturen je Blattname: 'headerrow' | 'positional' | 'totals' | 'skipblank'
 *   (auch mehrere als Liste). Ohne Korrektur werden fehlerhafte Blätter übersprungen und als `issues` gemeldet.
 * @returns {null | {rounds: Array<{sheet,jahr,typ,liga,spieltage:number[],players:Array<{name,perDay:Object}>,fixes:string[]}>,
 *   ignored:string[], warnings:string[],
 *   issues:Array<{sheet:string,kind:string,problem:string,suggestion:string,fix:string|null,fixLabel:string|null,recommended:boolean,applied:boolean}>}}
 *   null, wenn die Datei kein Chronik-Format hat.
 */
export function parseChronik(data, { fixes = {} } = {}) {
  const wb = XLSX.read(data, { type: 'array', cellFormula: false, sheetRows: 400 });
  const rounds = [];
  const ignored = [];
  const warnings = [];
  const issues = [];
  for (const sheet of wb.SheetNames) {
    const meta = parseChronikSheetName(sheet);
    const ws = wb.Sheets[sheet];
    const info = inspectSheet(ws);
    const want = new Set([].concat(fixes[sheet] ?? []));
    const issue = (kind, problem, suggestion, fix, recommended = true) =>
      issues.push({ sheet, kind, problem, suggestion, fix, fixLabel: fix ? FIXES[fix] : null, recommended, applied: !!fix && want.has(fix) });

    if (!meta) {
      if (info.headerCols.length >= 2) {
        ignored.push(sheet);
        issue('sheetname', 'Der Blattname enthält keine erkennbare Halbserie (erwartet z. B. „Hinrunde 2010-2011 L1“), die Tabelle sieht aber nach einer Halbserie aus.',
          'Blatt in der Excel-Datei so umbenennen und erneut hochladen.', null);
      } else ignored.push(sheet);
      continue;
    }

    // --- Kopfzeile / Spieltagsspalten ---
    const found = info.headerRow >= 0;
    const headerOk = info.headerRow === 0 && info.headerCols.length >= info.dayRun;
    let cols = info.headerCols;
    let start = info.start;
    const applied = [];
    if (!headerOk) {
      const c1 = cell(ws, 0, FIRST_DAY_COL);
      const hdrCols = found ? info.headerCols : [];
      if (found && info.headerRow > 0 && info.headerCols.length >= info.dayRun) {
        const above = Array.from({ length: info.headerRow }, (_, i) => nameOf(cell(ws, i, 1))).filter(Boolean);
        issue('headerrow',
          `Die Spieltags-Kopfzeile steht erst in Zeile ${info.headerRow + 1}. Darüber stehen ${info.headerRow} Zeile(n) mit Resten${above.length ? ` (z. B. „${above[0]}“)` : ''}, deshalb wurde das Blatt nicht erkannt.`,
          `Die Zeilen 1–${info.headerRow} ignorieren und die Spieler ab Zeile ${info.headerRow + 2} lesen.${sumCheck(ws, info.rows, hdrCols)}`,
          'headerrow');
        if (want.has('headerrow')) applied.push('headerrow');
        else { ignored.push(sheet); continue; }
      } else if (info.dayRun >= 2) {
        const last = FIRST_DAY_COL + info.dayRun - 1;
        const reason = !found
          ? `In der Kopfzeile fehlt die Spieltagsnummerierung 1, 2, 3 … ab Spalte C (C1: „${c1 ?? ''}“).`
          : `Die Kopfzeile nummeriert nur ${info.headerCols.length} Spieltage lückenlos, in den Daten stehen aber Werte in ${info.dayRun} Spalten.`;
        const cand = Array.from({ length: info.dayRun }, (_, i) => FIRST_DAY_COL + i);
        issue('header', reason,
          `Spalten C–${colName(last)} als Spieltage 1–${info.dayRun} lesen.${sumCheck(ws, info.rows, cand)}`, 'positional');
        if (want.has('positional')) { cols = cand; applied.push('positional'); }
        else { ignored.push(sheet); continue; }
      } else if (info.dayRun === 1) {
        issue('totals', 'Das Blatt enthält je Spieler nur einen Wert (Spalte C = Gesamtpunkte), keine Punkte je Spieltag.',
          'Gesamtpunkte als einen Sammel-Spieltag importieren: Rangfolge und Summe stimmen, Spieltagswerte fehlen. (Nicht vorausgewählt.)',
          'totals', false);
        if (want.has('totals')) { cols = [FIRST_DAY_COL]; applied.push('totals'); }
        else { ignored.push(sheet); continue; }
      } else { ignored.push(sheet); continue; }
    }

    // --- Leerzeilen innerhalb der Spielerliste ---
    if (info.extra.length) {
      issue('blank', `Unter einer Leerzeile in Spalte B stehen noch ${info.extra.length} weitere Zeilen mit Punkten (ab Zeile ${info.extra[0] + 1}), die nicht gelesen würden.`,
        'Leerzeilen überspringen und auch die Spieler darunter einlesen.', 'skipblank');
      if (want.has('skipblank')) applied.push('skipblank');
    }

    const players = [];
    const seen = new Set();
    const lastRow = applied.includes('skipblank') ? 399 : (info.rows.length ? info.rows[info.rows.length - 1] : start);
    for (let r = start; r <= lastRow; r++) {
      const name = nameOf(cell(ws, r, 1));
      if (!name) continue;
      if (seen.has(name)) { warnings.push(`Blatt "${sheet}": Name "${name}" kommt doppelt vor (2. Eintrag ignoriert).`); continue; }
      seen.add(name);
      const perDay = {};
      cols.forEach((c, i) => { const v = num(cell(ws, r, c)); if (v !== null) perDay[i + 1] = v; });
      players.push({ name, perDay });
    }
    if (!players.length) { ignored.push(sheet); continue; }
    rounds.push({ sheet, ...meta, spieltage: cols.map((_, i) => i + 1), players, fixes: applied });
  }
  return rounds.length || issues.length ? { rounds, ignored, warnings, issues } : null;
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
