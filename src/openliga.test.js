import { describe, it, expect } from 'vitest';
import { mapMatches, matchState, currentSpieltag, needsPolling } from './openliga.js';

const H = 3600e3;
const NOW = Date.parse('2026-11-22T16:00:00Z');
const m = (spieltag, kickoffH, finished = false) => ({ spieltag, finished, kickoff: NOW + kickoffH * H, key: `${spieltag}-${kickoffH}` });

describe('Spieltag-Zustand', () => {
  it('Zustand je Spiel', () => {
    expect(matchState(m(1, -5, true), NOW)).toBe('done');
    expect(matchState(m(1, -1), NOW)).toBe('live');
    expect(matchState(m(1, 2), NOW)).toBe('pending');
  });
  it('Spieltag läuft, bis das letzte Spiel beendet ist', () => {
    const day = [m(12, -30, true), m(12, -2, true), m(12, -1), m(12, 20)]; // ein Spiel läuft, eins steht noch aus
    expect(currentSpieltag(day, NOW)).toBe(12);
    const allDone = day.map((x) => ({ ...x, finished: true }));
    expect(currentSpieltag(allDone, NOW)).toBeNull();
  });
  it('zwischen den Anstößen eines Spieltags bleibt er markiert', () => {
    expect(currentSpieltag([m(5, -20, true), m(5, 4), m(5, 6)], NOW)).toBe(5);
  });
  it('noch nicht begonnener Spieltag und weit verschobene Nachholspiele zählen nicht', () => {
    expect(currentSpieltag([m(6, 30), m(6, 31)], NOW)).toBeNull();
    expect(currentSpieltag([m(7, -200, true), m(7, -199, true), m(7, 24 * 20)], NOW)).toBeNull();
  });
  it('höchster laufender Spieltag, wenn mehrere offen sind', () => {
    expect(currentSpieltag([m(3, -3), m(3, 1), m(4, -1), m(4, 5)], NOW)).toBe(4);
  });
  it('Aktualisierung jede Minute nur bei laufendem Spieltag oder kurz vor Anstoß', () => {
    expect(needsPolling([m(1, -1), m(1, 2)], NOW)).toBe(true);
    expect(needsPolling([m(2, 0.5)], NOW)).toBe(true);
    expect(needsPolling([m(2, 10)], NOW)).toBe(false);
    expect(needsPolling([m(2, -3, true)], NOW)).toBe(false);
  });
});

describe('mapMatches', () => {
  const api = (over) => ({
    team1: { teamName: 'FC Bayern München' }, team2: { teamName: 'VfB Stuttgart' }, group: { groupOrderID: 3 },
    matchDateTimeUTC: '2026-11-22T14:30:00Z', matchIsFinished: false, matchResults: [], goals: [], ...over,
  });
  it('Zwischenstand aus dem letzten Tor, Anstoßzeit als Zahl', () => {
    const [x] = mapMatches([api({ goals: [{ goalID: 2, scoreTeam1: 2, scoreTeam2: 0 }, { goalID: 1, scoreTeam1: 1, scoreTeam2: 0 }] })]);
    expect(x).toMatchObject({ finished: false, lh: 2, lg: 0, kickoff: Date.parse('2026-11-22T14:30:00Z'), spieltag: 3 });
  });
  it('ohne Tor 0:0, beendet mit Endstand', () => {
    expect(mapMatches([api()])[0]).toMatchObject({ lh: 0, lg: 0, h: null });
    const done = mapMatches([api({ matchIsFinished: true, matchResults: [{ resultTypeID: 2, pointsTeam1: 3, pointsTeam2: 1 }] })])[0];
    expect(done).toMatchObject({ finished: true, h: 3, g: 1 });
  });
});
