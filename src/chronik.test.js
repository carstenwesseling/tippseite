import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseChronik, parseChronikSheetName, renameChronik } from './chronik.js';
import { buildTable } from './scoring.js';
import { findNameGroups } from './matching.js';

const wbOf = (rows, name = 'Hinrunde 2010-2011 L1') => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
};

describe('Chronik', () => {
  it('liest Blattnamen', () => {
    expect(parseChronikSheetName('Rückrunde 2011-2012 L2')).toEqual({ typ: 'rueck', jahr: 2011, liga: 2 });
    expect(parseChronikSheetName('Hinrunde 2010-2011 L1')).toEqual({ typ: 'hin', jahr: 2010, liga: 1 });
    expect(parseChronikSheetName('Tabelle1')).toBeNull();
  });
  it('liest nur bis Spalte S und rechnet die Summe selbst', () => {
    const head = [null, null, ...Array.from({ length: 17 }, (_, i) => i + 1), 'Gesamt', null, '2er'];
    const row = ['1.', 'Müller,A.', ...Array(17).fill(5), 999, null, 14];
    const row2 = [null, 'Schmidt,K.', '-', '-', ...Array(15).fill(4), 60, null, 1];
    const r = parseChronik(wbOf([head, row, row2]));
    const rd = r.rounds[0];
    expect(rd.spieltage).toHaveLength(17);
    expect(rd.players).toHaveLength(2);
    const t = buildTable(rd.players, [], rd.spieltage);
    expect(t[0].name).toBe('Müller,A.');
    expect(t[0].total).toBe(85); // nicht 999
    expect(t[1].total).toBe(60);
    expect(rd.players[1].perDay[1]).toBeUndefined(); // "-" = nicht gewertet
  });
  it('erkennt normale Tippdateien nicht als Chronik', () => {
    expect(parseChronik(wbOf([['a', 'b'], ['c', 'd']], 'Müller,A.'))).toBeNull();
  });
  it('benennt um und meldet Kollisionen', () => {
    const rounds = [{ sheet: 'x', players: [{ name: 'A', perDay: {} }, { name: 'B', perDay: {} }] }];
    const w = [];
    expect(renameChronik(rounds, { B: 'A' }, w)[0].players).toHaveLength(1);
    expect(w).toHaveLength(1);
  });
  it('strenge Namensprüfung: nur passende Vornamen-Kürzel', () => {
    const g = findNameGroups(['Möller,M.', 'Möller,Marcel', 'Möller,B.', 'Kleeschulte,H.', 'Kleeschulte,N.'], { strict: true });
    expect(g).toHaveLength(1);
    expect(g[0].sort()).toEqual(['Möller,M.', 'Möller,Marcel']);
  });
});

const FILE = '/root/.claude/uploads/1e608d66-c297-5793-9a0c-fd35aac8c796/b720de38-Chronik_2.xlsx';
describe.skipIf(!existsSync(FILE))('Beispiel-Chronik', () => {
  it('liest alle 16 Halbserien', () => {
    const r = parseChronik(new Uint8Array(readFileSync(FILE)));
    expect(r.rounds).toHaveLength(16);
    const first = r.rounds[0];
    const t = buildTable(first.players, [], first.spieltage);
    expect(t[0].name).toBe('Kleeschulte,Mrt.');
    expect(t[0].total).toBe(96);
    const names = [...new Set(r.rounds.flatMap((x) => x.players.map((p) => p.name)))];
    console.log(names.length, 'Namen;', findNameGroups(names, { strict: true }).map((g) => g.join(' | ')));
  });
});
