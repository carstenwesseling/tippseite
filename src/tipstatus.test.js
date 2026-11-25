import { describe, it, expect } from 'vitest';
import { validTipCount, tipState, tipStatus, hasStarted, firstKickoff } from './tipstatus.js';

const order = [1, 2, 3].map((i) => ({ key: `a${i}|b${i}`, date: `2026-08-2${i}T20:30:00` }));

describe('Tippstatus', () => {
  it('zählt nur vollständige Ergebnisse', () => {
    expect(validTipCount({ 'a1|b1': { h: 1, g: 0 }, 'a2|b2': { h: 2 }, 'a3|b3': { h: null, g: 1 }, x: { h: 1, g: 1 } }, order)).toBe(1);
  });
  it('Zustand', () => {
    expect(tipState(3, 3)).toBe('komplett');
    expect(tipState(1, 3)).toBe('teilweise');
    expect(tipState(0, 3)).toBe('keiner');
  });
  it('akzeptiert per Excel eingelesene Tipps aus der Halbserie', () => {
    const roundPlayers = [{ name: 'Müller, A.', tips: { 'a1|b1': { h: 1, g: 1 }, 'a2|b2': { h: 0, g: 0 }, 'a3|b3': { h: 2, g: 2 } } }];
    const s = tipStatus({ name: 'Müller,A.', tippingTips: {}, roundPlayers, order });
    expect(s).toMatchObject({ count: 3, state: 'komplett', source: 'excel' });
  });
  it('nimmt den vollständigeren Stand', () => {
    const s = tipStatus({ name: 'X', tippingTips: { 'a1|b1': { h: 1, g: 0 } }, roundPlayers: [], order });
    expect(s).toMatchObject({ count: 1, state: 'teilweise', source: 'tippen' });
  });
  it('Beginn des ersten Spiels', () => {
    const k = firstKickoff(order);
    expect(hasStarted(order, k - 1)).toBe(false);
    expect(hasStarted(order, k)).toBe(true);
    expect(hasStarted([{ key: 'x' }], Date.now())).toBe(false);
  });
});
