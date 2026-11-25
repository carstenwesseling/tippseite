import { describe, it, expect } from 'vitest';
import { gamesByDay } from './spiele.js';

const round = { order: [
  { key: 'bayern|leipzig', home: 'FC Bayern München', away: 'RB Leipzig', block: 1 },
  { key: 'bremen|mainz', home: 'SV Werder Bremen', away: '1. FSV Mainz 05', block: 1 },
  { key: 'koeln|union', home: '1. FC Köln', away: '1. FC Union Berlin', block: 1 },
  { key: 'stuttgart|hamburg', home: 'VfB Stuttgart', away: 'Hamburger SV', block: 2 },
] };
const results = [
  { key: 'bayern|leipzig', spieltag: 1, h: 2, g: 1 },
  { key: 'bremen|mainz', spieltag: 1, h: 0, g: 0 },
];
const tips = { 'bayern|leipzig': { h: 2, g: 1 }, 'bremen|mainz': { h: 1, g: 1 }, 'koeln|union': { h: 1, g: 0 } };

describe('gamesByDay', () => {
  const days = gamesByDay(round, [], results, tips);
  it('liefert nur Spieltage mit Ergebnissen', () => expect(days.map((d) => d.day)).toEqual([1]));
  it('zählt Punkte und Treffer', () => {
    expect(days[0]).toMatchObject({ sum: 3, z: 1, e: 1, n: 0, open: 1, live: false });
    expect(days[0].rows.map((r) => r.pts)).toEqual([2, 1, null]);
  });
  it('kürzt Vereinsnamen', () => expect(days[0].rows[0]).toMatchObject({ home: 'Bayern', away: 'Leipzig' }));
  it('fehlender Tipp gibt 0 Punkte', () => {
    const d = gamesByDay(round, [], results, {});
    expect(d[0]).toMatchObject({ sum: 0, n: 2 });
    expect(d[0].rows[0].tip).toBeNull();
  });
});
