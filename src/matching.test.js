import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { planTeams, findNameGroups, findSpellingVariants, mergePlayers } from './matching.js';
import { parseWorkbook } from './excel.js';
import { BUNDESLIGA_FALLBACK } from './teams.js';

describe('Vereinszuordnung', () => {
  const plan = Object.fromEntries(planTeams(['Paderborn', 'Elversberg', 'Köln', 'Bayern', 'Fortuna'], BUNDESLIGA_FALLBACK).map((p) => [p.name, p.suggestion]));
  it('erkennt Paderborn und Elversberg', () => {
    expect(plan.Paderborn).toBe('SC Paderborn 07');
    expect(plan.Elversberg).toBe('SV 07 Elversberg');
    expect(plan.Köln).toBe('1. FC Köln');
    expect(plan.Bayern).toBe('FC Bayern München');
  });
  it('lässt Unbekanntes ohne Vorschlag', () => expect(plan.Fortuna).toBeNull());
});

describe('Mitspielernamen', () => {
  it('fragt bei ähnlichen Namen, nicht bei klar verschiedenen', () => {
    const g = findNameGroups(['Müller,A.', 'Mueller,A. 2', 'Müller,B.', 'Schmidt,K.', 'Wesseling,C.']);
    expect(g).toHaveLength(1);
    expect(g[0]).toContain('Müller,A.');
    expect(g[0]).toContain('Müller,B.');
  });
  it('führt zusammen', () => {
    const p = [{ name: 'A', tips: { x: { h: 1, g: 0 } }, matchCount: 2 }, { name: 'A 2', tips: { y: { h: 2, g: 2 } }, matchCount: 2 }];
    const r = mergePlayers(p, [{ names: ['A', 'A 2'], into: 'A' }]);
    expect(r.players).toHaveLength(1);
    expect(Object.keys(r.players[0].tips)).toEqual(['x', 'y']);
  });
});

describe('Umbenennen beim Einlesen', () => {
  it('wendet rename auf Tippschlüssel an', () => {
    const rows = [[], ['', '', '', '', 'Tipp'], ['Paderborn', '-', 'Elversberg', 2, ':', 1]];
    const ws = XLSX.utils.aoa_to_sheet([[null, null, null, null, 'Tipp'], ['Paderborn', '-', 'Elversberg', 2, ':', 1]]);
    // Tipp-Anker steht in Spalte 4 (c): Heim c-4=0, Gast c-2=2, Tipp H c-1=3, Tipp G c+1=5
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Test,T.');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const a = parseWorkbook(new Uint8Array(buf));
    expect(a.teams.sort()).toEqual(['Elversberg', 'Paderborn']);
    const b = parseWorkbook(new Uint8Array(buf), { rename: { Paderborn: 'SC Paderborn 07' } });
    expect(b.order[0].home).toBe('SC Paderborn 07');
    expect(rows).toBeTruthy();
  });
});

describe('Schreibweisen', () => {
  it('schlägt je abweichende Schreibweise einen Vorschlag vor', () => {
    const counts = new Map([['Möller,H.', 40], ['Möller.H.', 1], ['Müser,M.', 45], ['Müser.M.', 1], ['Müser, M', 1]]);
    const v = findSpellingVariants([...counts.keys()], { counts });
    expect(v).toEqual(expect.arrayContaining([
      { from: 'Möller.H.', to: 'Möller,H.' }, { from: 'Müser.M.', to: 'Müser,M.' }, { from: 'Müser, M', to: 'Müser,M.' },
    ]));
    expect(v).toHaveLength(3);
  });
  it('bevorzugt bekannte Mitglieder und trennt verschiedene Personen', () => {
    const v = findSpellingVariants(['Kleeschulte,H.', 'Kleeschulte,Mrt.', 'Kleeschulte,M.', 'Wesseling, C.', 'Wesseling,C.'], { known: new Set(['Wesseling, C.']) });
    expect(v).toEqual([{ from: 'Wesseling,C.', to: 'Wesseling, C.' }]);
  });
  it('Namen werden ohne Leerzeichen nach dem Komma gelesen', async () => {
    const { canonName } = await import('./halbserie.js');
    expect(canonName('  Müller ,  A. ')).toBe('Müller,A.');
    expect(canonName('Schneider, Chr.  (TV)')).toBe('Schneider,Chr. (TV)');
  });
});
