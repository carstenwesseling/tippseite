import { describe, it, expect } from 'vitest';
import { buildTipWorkbook, groupByDay, sheetName, tipFileName } from './tipsheet.js';
import { parseWorkbook } from './excel.js';
import { matchKey } from './teams.js';
import { detectHalbserie, nameFromFilename } from './halbserie.js';

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

describe('Excel-Tippschein: Mailanhang und Upload', () => {
  // Spielplan mit offiziellen Namen wie von OpenLigaDB (inkl. Elversberg/Paderborn), Schlüssel wie beim Eröffnen der Tipprunde
  const FULL = ['FC Bayern München', 'RB Leipzig', 'TSG Hoffenheim', 'Bayer 04 Leverkusen', 'SV Werder Bremen', 'Eintracht Frankfurt', 'FC Augsburg', 'SC Freiburg', '1. FC Köln', '1. FSV Mainz 05', 'Hamburger SV', 'Borussia Mönchengladbach', 'VfB Stuttgart', '1. FC Union Berlin', 'Borussia Dortmund', 'SC Paderborn 07', 'SV 07 Elversberg', '1. FC Heidenheim 1846'];
  const real = () => {
    const out = [];
    for (let d = 1; d <= 17; d++) for (let i = 0; i < 9; i++) {
      const home = FULL[(i + d) % 18], away = FULL[(i + d + 9) % 18];
      out.push({ key: matchKey(home, away), spieltag: d, home, away });
    }
    return out.filter((m, i, a) => a.findIndex((x) => x.key === m.key) === i);
  };

  it('leerer Tippschein (keine Tipps) wird erzeugt und beim Upload als Spieler erkannt', async () => {
    const o = real();
    const buf = await buildTipWorkbook({ title: 'Hinrunde 26/27', playerName: 'Wesseling,C.', order: o, tips: {} });
    const parsed = parseWorkbook(new Uint8Array(buf));
    expect(parsed.players).toHaveLength(1);
    expect(parsed.players[0].name).toBe('Wesseling,C.');
    expect(parsed.players[0].matchCount).toBe(o.length);
    expect(parsed.players[0].tipCount).toBe(0);
  });

  it('Tipps landen beim richtigen Spiel (Schlüssel wie im Spielplan, auch Elversberg/Paderborn)', async () => {
    const o = real();
    const els = o.find((m) => m.home.includes('Elversberg') || m.away.includes('Elversberg'));
    const pad = o.find((m) => m.home.includes('Paderborn') || m.away.includes('Paderborn'));
    const tips = { [o[0].key]: { h: 3, g: 0 }, [els.key]: { h: 1, g: 2 }, [pad.key]: { h: 0, g: 0 } };
    const buf = await buildTipWorkbook({ title: 'Hinrunde 26/27', playerName: 'Müller,R.', order: o, tips });
    const p = parseWorkbook(new Uint8Array(buf)).players[0];
    expect(p.tips).toEqual(tips);
  });

  it('Dateiname enthält Saison und Runde und wird vom Upload erkannt', () => {
    const f = tipFileName('Rückrunde 26/27', 'Wesseling,C.');
    expect(f).toBe('Tippschein Rückrunde 26-27 Wesseling,C..xlsx');
    expect(detectHalbserie(f)).toEqual({ jahr: 2026, typ: 'rueck' });
    expect(nameFromFilename(f)).toBe('Wesseling,C.');
  });
});
