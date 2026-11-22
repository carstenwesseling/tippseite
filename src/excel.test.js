import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseWorkbook } from './excel.js';
import { buildTable } from './scoring.js';

const FILE = 'fixtures/rueckrunde2526.xlsm';

describe.skipIf(!existsSync(FILE))('Beispieldatei Rückrunde 25/26', () => {
  const buf = existsSync(FILE) ? readFileSync(FILE) : null;
  const parsed = buf ? parseWorkbook(new Uint8Array(buf)) : null;

  it('erkennt Spielerblätter und 153 Spiele (17x9)', () => {
    expect(parsed.players.length).toBeGreaterThan(50);
    expect(parsed.players.find((p) => p.name === 'Wesseling,C.')).toBeTruthy();
    expect(parsed.order).toHaveLength(153);
    expect(parsed.warnings).toEqual([]);
  });

  it('berechnet Tabelle identisch zum Blatt "aktueller Stand"', () => {
    const results = parsed.excelResults.map((r) => ({ ...r, spieltag: 0 }));
    expect(results.length).toBeGreaterThan(100);
    const table = buildTable(parsed.players, results, [0]);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ref = XLSX.utils.sheet_to_json(wb.Sheets['aktueller Stand'], { header: 1 });
    let checked = 0;
    for (const row of ref.slice(1)) {
      const [, name, , , , , , , , , , , , , , , , , , total] = row;
      if (typeof name !== 'string' || typeof total !== 'number') continue;
      const mine = table.find((t) => t.name === name.trim());
      if (!mine) continue;
      expect(mine.total, name).toBe(total);
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });
});
