/* Beispieldaten für die Design-Vorschläge (nicht die echten Tipps). */
(function () {
  let s = 2611;
  const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const names = ['Carsten', 'Jürgen', 'Markus', 'Stefan', 'Thomas', 'Andreas', 'Michael', 'Frank', 'Uwe', 'Peter', 'Klaus', 'Dirk', 'Ralf', 'Bernd'];
  const first = 18, count = 17, played = 12;
  const players = names.map((name) => {
    const skill = 0.6 + rnd() * 0.8;
    let total = 0, zwei = 0, eins = 0; const perDay = [];
    for (let d = 0; d < count; d++) {
      if (d >= played) { perDay.push(null); continue; }
      let z = 0, e = 0;
      for (let m = 0; m < 9; m++) { const r = rnd(), pz = 0.1 * skill + 0.04, pe = 0.35 * skill + 0.12; if (r < pz) z++; else if (r < pz + pe) e++; }
      perDay.push(2 * z + e); total += 2 * z + e; zwei += z; eins += e;
    }
    return { name, perDay, total, zwei, eins, schnitt: total / played };
  }).sort((a, b) => b.total - a.total || b.zwei - a.zwei);
  players.forEach((p, i) => { const q = players[i - 1]; p.rank = q && q.total === p.total && q.zwei === p.zwei ? q.rank : i + 1; });
  const dayMax = Array.from({ length: count }, (_, d) => Math.max(...players.map((p) => p.perDay[d] ?? -1)));
  window.TIPP = {
    title: 'Rückrunde 25/26', rounds: ['Rückrunde 25/26', 'Hinrunde 25/26', 'Rückrunde 24/25'],
    stand: '20.11.2026', first, count, played, matches: played * 9, me: 'Carsten',
    days: Array.from({ length: count }, (_, i) => first + i), dayMax, max: Math.max(...dayMax), players,
  };
})();
