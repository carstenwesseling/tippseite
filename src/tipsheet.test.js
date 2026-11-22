import { describe, it, expect } from 'vitest';
import { buildTipWorkbook, groupByDay, sheetName } from './tipsheet.js';
import { parseWorkbook } from './excel.js';
import { matchKey } from './teams.js';

const NAMES = ['Bayern', 'Leipzig', 'Hoffenheim', 'Leverkusen', 'Bremen', 'Frankfurt', 'Augsburg', 'Freiburg', 'Köln', 'Mainz', 'Hamburg', 'Gladbach', 'Stuttgart', 'Union', 'Dortmund', 'St. Pauli', 'Wolfsburg', 'Heidenheim'];
function order() {
  const out = [];
  for (let d = 18; d < 35; d++) for (let i = 0; i < 9; i++) {
    const home = NAMES[(i + d) % 18], away = NAMES[(i + d + 9 + (d % 3)) % 18];
    if (home !== away) out.push({ key: matchKey(home, away) + '#' + d, spieltag: d, home, away });
  }
  return out;
}

describe('Excel-Tippschein', () => {
  it('Blattname = Spielername, ungültige Zeichen raus', () => {
    expect(sheetName('Müller/Meier: [A]')).toBe('Müller Meier A');
    expect(sheetName('x'.repeat(40))).toHaveLength(31);
  });

  it('lässt sich mit dem Excel-Parser wieder einlesen (Name, Spiele, Tipps)', async () => {
    const o = order();
    const tips = { [o[0].key]: { h: 2, g: 1 }, [o[10].key]: { h: 0, g: 0 } };
    const buf = await buildTipWorkbook({ title: 'Rückrunde 26/27', playerName: 'Wesseling,C.', order: o, tips });
    const parsed = parseWorkbook(new Uint8Array(buf));
    expect(parsed.players).toHaveLength(1);
    const p = parsed.players[0];
    expect(p.name).toBe('Wesseling,C.');
    expect(p.matchCount).toBe(o.length);
    expect(p.tipCount).toBe(2);
    expect(parsed.order.map((m) => m.block)).toEqual(expect.arrayContaining([1, 17]));
    expect(groupByDay(o)).toHaveLength(17);
  });
});
