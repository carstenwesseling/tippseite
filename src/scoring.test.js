import { describe, it, expect } from 'vitest';
import { scoreMatch, buildTable } from './scoring.js';

describe('scoreMatch', () => {
  it('exaktes Ergebnis = 2', () => expect(scoreMatch({ h: 2, g: 1 }, { h: 2, g: 1 })).toBe(2));
  it('exaktes Unentschieden = 2', () => expect(scoreMatch({ h: 1, g: 1 }, { h: 1, g: 1 })).toBe(2));
  it('richtige Tendenz Heimsieg = 1', () => expect(scoreMatch({ h: 3, g: 0 }, { h: 1, g: 0 })).toBe(1));
  it('richtige Tendenz Auswärtssieg = 1', () => expect(scoreMatch({ h: 0, g: 1 }, { h: 0, g: 4 })).toBe(1));
  it('Unentschieden-Tendenz = 1', () => expect(scoreMatch({ h: 0, g: 0 }, { h: 2, g: 2 })).toBe(1));
  it('falsch = 0', () => expect(scoreMatch({ h: 2, g: 0 }, { h: 0, g: 1 })).toBe(0));
  it('kein Tipp / kein Ergebnis = 0', () => {
    expect(scoreMatch(null, { h: 1, g: 0 })).toBe(0);
    expect(scoreMatch({ h: 1, g: 0 }, null)).toBe(0);
  });
});

describe('buildTable', () => {
  it('summiert pro Spieltag, rankt mit Gleichstand', () => {
    const results = [
      { key: 'a|b', spieltag: 1, h: 1, g: 0 },
      { key: 'c|d', spieltag: 2, h: 2, g: 2 },
    ];
    const players = [
      { name: 'A', tips: { 'a|b': { h: 1, g: 0 }, 'c|d': { h: 1, g: 1 } } }, // 2+1
      { name: 'B', tips: { 'a|b': { h: 2, g: 0 } } }, // 1
      { name: 'C', tips: { 'a|b': { h: 3, g: 0 } } }, // 1
    ];
    const t = buildTable(players, results, [1, 2]);
    expect(t[0]).toMatchObject({ name: 'A', total: 3, rank: 1, zwei: 1, eins: 1 });
    expect(t[1].rank).toBe(2);
    expect(t[2].rank).toBe(2);
  });
});
