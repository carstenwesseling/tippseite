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
  describe('fehlerhafte Blätter', () => {
    const head = [null, null, ...Array.from({ length: 17 }, (_, i) => i + 1), 'Gesamt'];
    const row = (n, v = 5) => [null, n, ...Array(17).fill(v), 17 * v];
    const wbMulti = (sheets) => {
      const wb = XLSX.utils.book_new();
      for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
      return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    };

    it('Kopfzeile erst in Zeile 3: meldet, schlägt Korrektur vor und liest sie nach Bestätigung', () => {
      const d = wbMulti({ 'Hinrunde 2000-2001': [[null, 'Rest,X.', ...Array(17).fill(1)], [], head, row('A,A.'), row('B,B.')] });
      const r = parseChronik(d);
      expect(r.rounds).toHaveLength(0);
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0]).toMatchObject({ sheet: 'Hinrunde 2000-2001', fix: 'headerrow', applied: false });
      expect(r.issues[0].problem).toContain('Zeile 3');
      expect(r.issues[0].suggestion).toContain('2 von 2');
      const fixed = parseChronik(d, { fixes: { 'Hinrunde 2000-2001': 'headerrow' } });
      expect(fixed.rounds[0].players.map((p) => p.name)).toEqual(['A,A.', 'B,B.']); // „Rest,X.“ gehört nicht dazu
      expect(fixed.rounds[0].spieltage).toHaveLength(17);
      expect(fixed.issues[0].applied).toBe(true);
    });
    it('fehlende Kopfzeile: Spieltage nach Spaltenposition', () => {
      const d = wbMulti({ 'Rückrunde 2001-2002': [row('A,A.'), row('B,B.', 4)] });
      expect(parseChronik(d).issues[0]).toMatchObject({ fix: 'positional', applied: false });
      const r = parseChronik(d, { fixes: { 'Rückrunde 2001-2002': 'positional' } });
      expect(r.rounds[0].players).toHaveLength(2);
      expect(r.rounds[0].spieltage).toHaveLength(17);
    });
    it('Kopfzeile bricht bei Spieltag 6 ab: zu wenige Spieltage werden gemeldet', () => {
      const h = [null, null, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
      const d = wbMulti({ 'Hinrunde 2005-2006': [h, row('A,A.'), row('B,B.')] });
      const r = parseChronik(d);
      expect(r.rounds).toHaveLength(0);
      expect(r.issues[0].problem).toContain('nur 5 Spieltage');
      expect(parseChronik(d, { fixes: { 'Hinrunde 2005-2006': 'positional' } }).rounds[0].spieltage).toHaveLength(17);
    });
    it('nur Gesamtpunkte: Summe in die Summenspalte, Spieltage leer', () => {
      const d = wbMulti({ 'Hinrunde 1998-1999': [[null, null, 'Gesamt'], ['1.', 'A,A.', 83], [null, 'B,B.', 70]] });
      const r = parseChronik(d);
      expect(r.issues[0]).toMatchObject({ kind: 'totals', fix: 'totals', recommended: false, applied: false });
      const t = parseChronik(d, { fixes: { 'Hinrunde 1998-1999': 'totals' } }).rounds[0];
      expect(t.totalsOnly).toBe(true);
      expect(t.spieltage).toHaveLength(17);
      expect(t.players[0]).toEqual({ name: 'A,A.', perDay: {}, total: 83 });
      const table = buildTable(t.players, [], t.spieltage);
      expect(table[0]).toMatchObject({ name: 'A,A.', total: 83, totalOnly: true });
      expect(table[1].total).toBe(70);
    });
    it('Spieler unter einer Leerzeile: Hinweis und Korrektur', () => {
      const d = wbMulti({ 'Hinrunde 2010-2011 L1': [head, row('A,A.'), [], row('B,B.')] });
      const r = parseChronik(d);
      expect(r.rounds[0].players).toHaveLength(1);
      expect(r.issues[0]).toMatchObject({ kind: 'blank', fix: 'skipblank' });
      expect(parseChronik(d, { fixes: { 'Hinrunde 2010-2011 L1': 'skipblank' } }).rounds[0].players).toHaveLength(2);
    });
    it('zwei Blätter mit gleicher Halbserie und Liga werden gemeldet', () => {
      const d = wbMulti({ 'Hinrunde 2010-2011 L1': [head, row('A,A.')], 'Hinrunde 2010-2011 L1 ': [head, row('B,B.')] });
      expect(parseChronik(d).warnings.join(' ')).toContain('dieselbe Halbserie und Liga');
    });
    it('Namen mit Leerzeichen nach dem Komma werden vereinheitlicht', () => {
      const d = wbMulti({ 'Hinrunde 2010-2011 L1': [head, [null, 'Müller, A.', ...Array(17).fill(5), 85]] });
      expect(parseChronik(d).rounds[0].players[0].name).toBe('Müller,A.');
    });
    it('korrekte Blätter erzeugen keine Hinweise', () => {
      expect(parseChronik(wbMulti({ 'Hinrunde 2010-2011 L1': [head, row('A,A.')] })).issues).toEqual([]);
    });
  });
  it('Tippdatei mit Blättern je Mitspieler (auch mit Zahlen 1, 2, 3 in einer Zeile) ist keine Chronik', () => {
    expect(parseChronik(wbOf([[null, null, 1, 2, 3], ['1.', 'A,A.', 5, 5, 5]], 'Müller,A.'))).toBeNull();
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
