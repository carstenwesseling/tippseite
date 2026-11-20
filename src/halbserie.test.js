import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { detectHalbserie, nameFromFilename, roundCode, roundLabel, seasonShort, normName, isGenericSheetName } from './halbserie.js';
import { parseWorkbook, mergeParsed } from './excel.js';

describe('detectHalbserie', () => {
  const cases = [
    ['rueckrunde2526.xlsm', 2025, 'rueck'],
    ['Tippspiel Hinrunde 22-23.xlsx', 2022, 'hin'],
    ['Tipps Rückrunde 2025/26.xlsx', 2025, 'rueck'],
    ['25_26_R.xlsx', 2025, 'rueck'],
    ['Hinrunde 202324.xlsm', 2023, 'hin'],
    ['Wesseling,C. 25-26 H.xlsx', 2025, 'hin'],
    ['Rückrunde 2026.xlsx', 2025, 'rueck'],
    ['Hinrunde 2025.xlsx', 2025, 'hin'],
    ['2019/20 Rückrunde.xlsx', 2019, 'rueck'],
    ['99_00 H.xlsx', 1999, 'hin'],
    ['Müller,R. 25_26.xlsx', 2025, null],
    ['irgendwas.xlsx', null, null],
  ];
  it.each(cases)('%s', (f, jahr, typ) => {
    expect(detectHalbserie(f)).toEqual({ jahr, typ });
  });
});

describe('nameFromFilename', () => {
  it.each([
    ['Wesseling,C. 25_26 R.xlsx', 'Wesseling,C.'],
    ['Tipps Müller,R. Rückrunde 2025-26.xlsx', 'Müller,R.'],
    ['Meier_Hans_2526_H.xlsx', 'Meier Hans'],
    ['Schmidt.xlsx', 'Schmidt'],
  ])('%s', (f, n) => expect(nameFromFilename(f)).toBe(n));
});

describe('Benennung', () => {
  it('Kurzform und Anzeige', () => {
    expect(roundCode({ jahr: 2025, typ: 'rueck' })).toBe('25/26 R');
    expect(roundCode({ jahr: 2022, typ: 'hin' })).toBe('22/23 H');
    expect(seasonShort(1999)).toBe('99/00');
    expect(roundLabel({ jahr: 2025, typ: 'rueck' })).toBe('2025/26 · Rückrunde');
  });
  it('Namensvergleich', () => {
    expect(normName(' Wesseling, C. ')).toBe(normName('wesseling,c.'));
    expect(isGenericSheetName('Tabelle1')).toBe(true);
    expect(isGenericSheetName('Wesseling,C.')).toBe(false);
  });
});

// Hilfsfunktion: ein Tippblatt wie in der echten Datei bauen (Block mit Kopfzelle "Tipp").
function sheet(rows) {
  const aoa = [[null, null, null, null, 'Tipp']];
  for (const [h, g, th, tg] of rows) aoa.push([h, '-', g, th, ':', tg]);
  return XLSX.utils.aoa_to_sheet(aoa);
}
function book(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, sheet(rows), name);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
const GAMES = [['Bayern', 'Dortmund', 2, 1], ['Leipzig', 'Bremen', 1, 1]];

describe('Einzelne Arbeitsblätter', () => {
  it('Blattname Tabelle1 -> Name aus Dateiname', () => {
    const p = parseWorkbook(book({ Tabelle1: GAMES }), { fallbackName: 'Meier,H.' });
    expect(p.players.map((x) => x.name)).toEqual(['Meier,H.']);
    expect(p.order).toHaveLength(2);
  });
  it('echter Blattname bleibt erhalten', () => {
    const p = parseWorkbook(book({ 'Meier,H.': GAMES }), { fallbackName: 'egal' });
    expect(p.players[0].name).toBe('Meier,H.');
  });
  it('mehrere Dateien werden zusammengeführt', () => {
    const a = parseWorkbook(book({ A: GAMES }));
    const b = parseWorkbook(book({ B: GAMES, A: GAMES }));
    const m = mergeParsed([a, b]);
    expect(m.players.map((x) => x.name).sort()).toEqual(['A', 'B']);
    expect(m.warnings.some((w) => w.includes('mehrfach'))).toBe(true);
  });
});
