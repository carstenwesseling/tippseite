import * as XLSX from 'xlsx';
import { matchKey, isKnownTeam } from './teams.js';

// Blätter, die keine Spielerblätter sind (Präfixe, Groß-/Kleinschreibung egal).
const IGNORE_PREFIX = ['namen', 'ergebnisse', 'aktueller stand', 'bezahlt', 'ewige'];
const IGNORE_SUFFIX = [' l2']; // 2. Liga-Runden der Datei
const RESULT_SHEET = 'ergebnisse';
const MAX_ROWS_PER_BLOCK = 12;

const cellValue = (ws, r, c) => (c < 0 || r < 0 ? undefined : ws[XLSX.utils.encode_cell({ r, c })]?.v);
const asNum = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};
const asText = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * Liest alle Spielblöcke eines Blatts. Ein Block beginnt an einer Zelle mit "Tipp":
 *   [Heim][-][Gast][Tipp H][:][Tipp G]   (Spalten c-4 … c+1, Zeile darunter je Spiel)
 *   Ergebnisblatt: Ergebnis in Spalten c+2 / c+4.
 * Blöcke werden spaltenweise von links nach rechts, oben nach unten nummeriert.
 */
export function parseSheetMatches(ws) {
  const anchors = [];
  for (const addr of Object.keys(ws)) {
    if (addr[0] === '!') continue;
    if (asText(ws[addr].v) === 'Tipp') anchors.push(XLSX.utils.decode_cell(addr));
  }
  anchors.sort((a, b) => a.c - b.c || a.r - b.r);

  const matches = [];
  anchors.forEach((a, blockIdx) => {
    for (let i = 1; i <= MAX_ROWS_PER_BLOCK; i++) {
      const home = asText(cellValue(ws, a.r + i, a.c - 4));
      const away = asText(cellValue(ws, a.r + i, a.c - 2));
      if (!home || !away) break;
      const tH = asNum(cellValue(ws, a.r + i, a.c - 1));
      const tG = asNum(cellValue(ws, a.r + i, a.c + 1));
      const rH = asNum(cellValue(ws, a.r + i, a.c + 2));
      const rG = asNum(cellValue(ws, a.r + i, a.c + 4));
      matches.push({
        block: blockIdx + 1,
        home,
        away,
        key: matchKey(home, away),
        tip: tH !== null && tG !== null ? { h: tH, g: tG } : null,
        res: rH !== null && rG !== null ? { h: rH, g: rG } : null,
      });
    }
  });
  return matches;
}

export function isPlayerSheetName(name) {
  const n = name.trim().toLowerCase();
  if (IGNORE_PREFIX.some((p) => n.startsWith(p))) return false;
  if (IGNORE_SUFFIX.some((s) => n.endsWith(s))) return false;
  return true;
}

/**
 * @param {ArrayBuffer|Uint8Array} data Inhalt der .xlsx/.xlsm
 */
export function parseWorkbook(data) {
  const wb = XLSX.read(data, { type: 'array', cellFormula: false });
  const players = [];
  const ignored = [];
  const warnings = [];
  let order = null; // Spielplan (Reihenfolge, Blöcke)
  let excelResults = null;

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (name.trim().toLowerCase() === RESULT_SHEET) {
      const ms = parseSheetMatches(ws).filter((m) => m.res);
      if (ms.length) excelResults = ms.map((m) => ({ key: m.key, block: m.block, h: m.res.h, g: m.res.g }));
      ignored.push(name);
      continue;
    }
    if (!isPlayerSheetName(name)) {
      ignored.push(name);
      continue;
    }
    const matches = parseSheetMatches(ws);
    if (!matches.length) {
      ignored.push(name); // kein Tippblatt
      continue;
    }
    const tips = {};
    const unknown = new Set();
    for (const m of matches) {
      if (m.tip) tips[m.key] = m.tip;
      for (const t of [m.home, m.away]) if (!isKnownTeam(t)) unknown.add(t);
    }
    unknown.forEach((t) => warnings.push(`Blatt "${name}": unbekannter Verein "${t}"`));
    if (!order) order = matches.map(({ block, home, away, key }) => ({ block, home, away, key }));
    players.push({
      name: name.trim(),
      tips,
      matchCount: matches.length,
      tipCount: Object.keys(tips).length,
    });
  }

  if (!players.length) warnings.push('Keine Spielerblätter gefunden.');
  const counts = new Set(players.map((p) => p.matchCount));
  if (counts.size > 1) warnings.push(`Spielerblätter haben unterschiedlich viele Spiele: ${[...counts].join(', ')}`);

  return { players, ignored, warnings, order: order ?? [], excelResults };
}
