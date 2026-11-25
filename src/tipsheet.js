// Excel-Tippschein für einen Mitspieler: alle Spieltage einer Halbserie auf einer DIN-A4-Seite (Hochformat).
// Aufbau wie in den Excel-Dateien, die der Parser (excel.js) liest: je Spieltag ein Block
//   [Heim][-][Gast][Tipp H][:][Tipp G]  mit Kopfzelle "Tipp" über dem Doppelpunkt,
// Blätter heißen wie der Spieler. Die Datei lässt sich deshalb auch wieder hochladen.
import { shortName } from './teams.js';

const COLS = 3;          // Blockspalten nebeneinander
const BLOCK_W = 6;       // Spalten je Block
const GAP_W = 1;         // Leerspalte zwischen Blockspalten
const GREEN = 'FF0B7A3F';
const SOFT = 'FFDFF1E5';
const LINE = { style: 'thin', color: { argb: 'FFB8C4BC' } };

/** Ungültige Zeichen für Blattnamen entfernen (max. 31 Zeichen). */
export const sheetName = (name) => String(name).replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Tipps';

/** Spiele nach Spieltag gruppieren (aufsteigend). */
export function groupByDay(order) {
  const days = new Map();
  for (const m of order) {
    if (!days.has(m.spieltag)) days.set(m.spieltag, []);
    days.get(m.spieltag).push(m);
  }
  return [...days.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * @param {{title:string, playerName:string, order:Array<{key,spieltag,home,away}>, tips:Record<string,{h,g}>}} p
 * @returns {Promise<ArrayBuffer>} .xlsx
 */
export async function buildTipWorkbook({ title, playerName, order, tips = {} }) {
  const { default: ExcelJS } = await import('exceljs');
  const days = groupByDay(order);
  const rowsPerCol = Math.ceil((days.length + 1) / COLS); // +1: freier Platz für die Legende
  const perBlock = Math.max(...days.map(([, ms]) => ms.length));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tippspiel';
  const ws = wb.addWorksheet(sheetName(playerName), {
    pageSetup: {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1,
      horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    headerFooter: { oddFooter: `&L&8${title}&R&8${playerName}` },
  });

  // Spaltenbreiten (Zeichen): Heim, -, Gast, Tipp H, :, Tipp G, Lücke
  const widths = [11.5, 1.8, 11.5, 4.2, 1.8, 4.2];
  for (let c = 0; c < COLS; c++) {
    widths.forEach((w, i) => { ws.getColumn(c * (BLOCK_W + GAP_W) + 1 + i).width = w; });
    if (c < COLS - 1) ws.getColumn(c * (BLOCK_W + GAP_W) + BLOCK_W + 1).width = 2;
  }
  const lastCol = COLS * BLOCK_W + (COLS - 1) * GAP_W;
  const font = (o = {}) => ({ name: 'Calibri', size: 9, ...o });

  // Kopf: Titel und Name des Spielers
  ws.mergeCells(1, 1, 1, lastCol);
  Object.assign(ws.getCell(1, 1), { value: title });
  ws.getCell(1, 1).font = font({ size: 11, bold: true, color: { argb: 'FF5D6B62' } });
  ws.getRow(1).height = 16;
  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(2, 1).value = playerName;
  ws.getCell(2, 1).font = font({ size: 20, bold: true });
  ws.getCell(2, 1).alignment = { vertical: 'middle' };
  ws.getRow(2).height = 28;
  const HEAD_ROWS = 3; // Zeile 3 = schmale Trennzeile
  ws.getRow(3).height = 6;

  const blockHeight = 1 + perBlock + 1; // Kopf + Spiele + Lücke
  const slotTop = (slot) => HEAD_ROWS + 1 + (slot % rowsPerCol) * blockHeight;
  const slotLeft = (slot) => Math.floor(slot / rowsPerCol) * (BLOCK_W + GAP_W) + 1;

  days.forEach(([spieltag, ms], slot) => {
    const r0 = slotTop(slot), c0 = slotLeft(slot);
    const h = ws.getRow(r0); h.height = 14;
    for (let i = 0; i < BLOCK_W; i++) {
      const cell = ws.getCell(r0, c0 + i);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
      cell.font = font({ bold: true, color: { argb: 'FFFFFFFF' } });
    }
    ws.getCell(r0, c0).value = `${spieltag}. Spieltag`;
    ws.getCell(r0, c0 + 4).value = 'Tipp'; // Anker für den Parser
    ws.getCell(r0, c0 + 4).alignment = { horizontal: 'center' };
    ms.forEach((m, i) => {
      const r = r0 + 1 + i;
      ws.getRow(r).height = 12.5;
      const tip = tips[m.key];
      const set = (off, value, opts = {}) => {
        const cell = ws.getCell(r, c0 + off);
        cell.value = value; cell.font = font(opts.font); cell.alignment = { vertical: 'middle', ...opts.align };
        return cell;
      };
      set(0, shortName(m.home), { align: { horizontal: 'right' } });
      set(1, '-', { align: { horizontal: 'center' }, font: { color: { argb: 'FF8A978F' } } });
      set(2, shortName(m.away));
      for (const [off, v] of [[3, tip?.h], [5, tip?.g]]) {
        const cell = set(off, Number.isFinite(v) ? v : null, { align: { horizontal: 'center' }, font: { bold: true, size: 10 } });
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
        cell.border = { top: LINE, bottom: LINE, left: LINE, right: LINE };
        cell.protection = { locked: false }; // nur die grünen Tippfelder sind bearbeitbar
      }
      set(4, ':', { align: { horizontal: 'center' } });
    });
  });

  // Legende im freien Platz
  const slot = days.length, lr = slotTop(slot), lc = slotLeft(slot);
  [['So wird getippt', true], ['Je Spiel Tore Heim : Gast.', false], ['Exaktes Ergebnis = 2 Punkte,', false], ['richtige Tendenz = 1 Punkt.', false]]
    .forEach(([text, bold], i) => {
      ws.mergeCells(lr + i, lc, lr + i, lc + BLOCK_W - 1);
      ws.getCell(lr + i, lc).value = text;
      ws.getCell(lr + i, lc).font = font({ bold, color: { argb: 'FF5D6B62' } });
    });

  // Blattschutz (ohne Passwort): alles gesperrt außer den Tippfeldern; auswählen und markieren bleibt möglich
  ws.protect('', { selectLockedCells: true, selectUnlockedCells: true });

  ws.pageSetup.printArea = `A1:${ws.getColumn(lastCol).letter}${HEAD_ROWS + rowsPerCol * blockHeight}`;
  return wb.xlsx.writeBuffer();
}

// "26/27" wird zu "26-27", damit der Upload Saison und Hin-/Rückrunde aus dem Dateinamen erkennt.
export const tipFileName = (title, playerName) =>
  `Tippschein ${title.replace(/\//g, '-')} ${playerName}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + '.xlsx';

/** ArrayBuffer -> Base64 (für den Mailversand-Anhang). */
export function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
