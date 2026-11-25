/* Gemeinsame Logik der Vorschläge „Tipps hinter den Punkten“ (Demo mit Beispieldaten).
   Klick auf einen Wert der Tabelle -> Übersicht der Spiele, die diesen Wert ergeben haben: Tipp neben dem echten Ergebnis.
   Route: #/<Name>/<Filter>   Filter: d29 (Spieltag), zwei (2er), eins (1er), total (Pkt)
   Jede Seite setzt vorher window.SB_UI = { mode: 'page' | 'sheet', render(ctx) -> HTML }. */
(function () {
  const TEAMS = ['Bayern', 'Leipzig', 'Hoffenheim', 'Leverkusen', 'Bremen', 'Frankfurt', 'Augsburg', 'Freiburg', 'Köln', 'Mainz',
    'Hamburg', 'Gladbach', 'Stuttgart', 'Union', 'Dortmund', 'St. Pauli', 'Wolfsburg', 'Heidenheim'];
  const FIRST = 18, COUNT = 17, PER = 9, PLAYED = 12;
  const NAMES = ['Carsten', 'Jürgen', 'Markus', 'Stefan', 'Thomas', 'Andreas', 'Michael', 'Frank', 'Uwe', 'Peter', 'Klaus', 'Dirk', 'Ralf', 'Bernd'];
  const ME = 'Carsten';

  let s = 4711;
  const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Punktelogik wie src/scoring.js: exakt 2, Tendenz 1
  const score = (t, r) => (!t || !r ? 0 : t.h === r.h && t.g === r.g ? 2 : Math.sign(t.h - t.g) === Math.sign(r.h - r.g) ? 1 : 0);

  // Spielplan (Rundenturnier, nur Demo)
  const arr = TEAMS.map((_, i) => i), DAYS = [];
  for (let r = 0; r < COUNT; r++) {
    const ms = [];
    for (let i = 0; i < PER; i++) {
      const a = arr[i], b = arr[arr.length - 1 - i], flip = (r + i) % 2;
      ms.push({ id: `${FIRST + r}-${i}`, home: TEAMS[flip ? b : a], away: TEAMS[flip ? a : b] });
    }
    DAYS.push({ day: FIRST + r, matches: ms });
    arr.splice(1, 0, arr.pop());
  }
  const goals = (avg) => { let n = 0, L = Math.exp(-avg), p = 1; do { n++; p *= rnd(); } while (p > L); return Math.min(n - 1, 6); };
  const RES = {};
  DAYS.slice(0, PLAYED).forEach((d) => d.matches.forEach((m) => { RES[m.id] = { h: goals(1.6), g: goals(1.25) }; }));

  const TYP = { 1: [[1, 0], [2, 0], [2, 1], [3, 1], [3, 0], [2, 1]], 0: [[1, 1], [1, 1], [0, 0], [2, 2]], '-1': [[0, 1], [0, 2], [1, 2], [1, 3], [0, 1]] };
  const tipFor = (r, skill) => {
    const x = rnd();
    if (x < 0.07 * skill + 0.03) return { h: r.h, g: r.g };
    const t = x < 0.07 * skill + 0.03 + 0.34 * skill ? Math.sign(r.h - r.g) : pick([1, 1, 0, -1, -1]);
    const [h, g] = pick(TYP[t]);
    return { h, g };
  };

  const players = NAMES.map((name) => {
    const skill = 0.65 + rnd() * 0.75, tips = {}, perDay = {};
    let zwei = 0, eins = 0, total = 0;
    DAYS.forEach((d, i) => d.matches.forEach((m) => {
      const r = RES[m.id];
      const t = tipFor(r || { h: 1, g: 1 }, skill);
      tips[m.id] = t;
      if (!r) return;
      const p = score(t, r);
      perDay[d.day] = (perDay[d.day] ?? 0) + p; total += p;
      if (p === 2) zwei++; else if (p === 1) eins++;
    }));
    return { name, tips, perDay, zwei, eins, total };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'de'));
  players.forEach((p, i) => { p.rank = i && players[i - 1].total === p.total ? players[i - 1].rank : i + 1; });
  const playedDays = DAYS.slice(0, PLAYED).map((d) => d.day);
  const dayMax = Object.fromEntries(playedDays.map((d) => [d, Math.max(...players.map((p) => p.perDay[d]))]));

  const href = (name, f) => `#/${encodeURIComponent(name)}/${f}`;
  const only = { d: false, zwei: true, eins: true, total: true }; // „nur Treffer“ je Filterart
  const type = (f) => (f[0] === 'd' ? 'd' : f);
  const sc = (x) => (x ? `${x.h}:${x.g}` : '–');
  const ptsLabel = (p) => (p === 2 ? 'exakt' : p === 1 ? 'Tendenz' : 'daneben');

  function ctx(name, f) {
    const p = players.find((x) => x.name === name);
    if (!p) return null;
    const ty = type(f), dayNo = ty === 'd' ? Number(f.slice(1)) : null;
    const wanted = ty === 'zwei' ? 2 : ty === 'eins' ? 1 : null;
    const src = dayNo ? DAYS.filter((d) => d.day === dayNo) : DAYS.slice(0, PLAYED);
    const canToggle = ty === 'd' || ty === 'total';
    const groups = [];
    const cnt = { z: 0, e: 0, n: 0 };
    src.forEach((d) => {
      const all = d.matches.map((m) => ({ m, tip: p.tips[m.id], res: RES[m.id], pts: score(p.tips[m.id], RES[m.id]) }));
      all.forEach((r) => { if (r.pts === 2) cnt.z++; else if (r.pts === 1) cnt.e++; else cnt.n++; });
      let rows = all;
      if (wanted) rows = all.filter((r) => r.pts === wanted);
      else if (canToggle && only[ty]) rows = all.filter((r) => r.pts > 0);
      if (rows.length) groups.push({ day: d.day, rows, sum: all.reduce((a, r) => a + r.pts, 0), hidden: all.length - rows.length, best: p.perDay[d.day] === dayMax[d.day] });
    });
    const value = ty === 'd' ? p.perDay[dayNo] : ty === 'zwei' ? p.zwei : ty === 'eins' ? p.eins : p.total;
    const unit = ty === 'zwei' ? 'exakte Tipps' : ty === 'eins' ? 'Tendenz-Tipps' : 'Punkte';
    const label = ty === 'd' ? `Spieltag ${dayNo}` : ty === 'zwei' ? 'Exakte Tipps · 2 Punkte' : ty === 'eins' ? 'Richtige Tendenz · 1 Punkt' : `Gesamt · ${PLAYED} Spieltage`;
    const formula = ty === 'zwei' ? `${cnt.z} × 2 Punkte = ${cnt.z * 2}` : ty === 'eins' ? `${cnt.e} × 1 Punkt = ${cnt.e}`
      : `${cnt.z} × 2 + ${cnt.e} × 1 = ${cnt.z * 2 + cnt.e}`;
    const i = players.indexOf(p), di = playedDays.indexOf(dayNo);
    const tabs = [
      ...(dayNo ? [{ f, label: `Spieltag ${dayNo}`, n: p.perDay[dayNo] }] : []),
      { f: 'zwei', label: '2er', n: p.zwei }, { f: 'eins', label: '1er', n: p.eins }, { f: 'total', label: 'Pkt', n: p.total },
    ].map((t) => ({ ...t, href: href(name, t.f), active: t.f === f }));
    return {
      p, name, f, ty, dayNo, value, unit, label, formula, cnt, groups, tabs, canToggle, only: only[ty], me: name === ME,
      isBest: dayNo ? p.perDay[dayNo] === dayMax[dayNo] : false, dayMax: dayNo ? dayMax[dayNo] : null,
      back: '#/', prevP: i > 0 ? { name: players[i - 1].name, href: href(players[i - 1].name, f) } : null,
      nextP: i < players.length - 1 ? { name: players[i + 1].name, href: href(players[i + 1].name, f) } : null,
      prevD: dayNo && di > 0 ? { day: playedDays[di - 1], href: href(name, 'd' + playedDays[di - 1]) } : null,
      nextD: dayNo && di < playedDays.length - 1 ? { day: playedDays[di + 1], href: href(name, 'd' + playedDays[di + 1]) } : null,
    };
  }

  window.SB = { players, DAYS, FIRST, COUNT, PLAYED, ME, RES, esc, sc, score, ptsLabel, href, ctx, playedDays, dayMax };

  // ---- Tabelle ----
  const $ = (q) => document.querySelector(q);
  const tableHtml = (sel) => `<table><thead><tr><th class="c1">#</th><th class="c2">Name</th>${DAYS.map((d) => `<th class="day">${d.day}</th>`).join('')}
    <th class="stat sep">2er</th><th class="stat">1er</th><th class="ct">Pkt</th></tr></thead><tbody>${players.map((p) => {
    const cell = (cls, f, txt, extra = '') => `<td class="${cls}${sel && sel.name === p.name && sel.f === f ? ' sel' : ''}${extra}"><a href="${href(p.name, f)}" aria-label="${esc(p.name)}: ${esc(txt)} – Spiele anzeigen">${txt}</a></td>`;
    return `<tr class="${p.rank <= 3 ? 'top' : ''}${p.name === ME ? ' me' : ''}"><td class="c1"><span class="rk">${p.rank}</span></td>
      <td class="c2"><a href="${href(p.name, 'total')}">${esc(p.name)}</a></td>
      ${DAYS.map((d) => (d.day in p.perDay ? cell('day', 'd' + d.day, p.perDay[d.day], p.perDay[d.day] === dayMax[d.day] ? ' best' : '') : '<td class="day pend">·</td>')).join('')}
      ${cell('stat sep', 'zwei', p.zwei)}${cell('stat', 'eins', p.eins)}${cell('ct', 'total', p.total)}</tr>`;
  }).join('')}</tbody></table>`;

  let lastScroll = 0;
  function route() {
    const [, n, f] = location.hash.split('/');
    const ui = window.SB_UI, c = n && f ? ctx(decodeURIComponent(n), f) : null;
    const wrap = $('#tablesec .wrap'), left = wrap.scrollLeft;
    $('#tablesec .wrap').innerHTML = tableHtml(c);
    wrap.scrollLeft = left;
    const det = $('#detail');
    if (!c) {
      det.hidden = true; document.body.classList.remove('detail-open');
      if (ui.mode === 'page') { $('#tablesec').hidden = false; window.scrollTo(0, lastScroll); }
      return;
    }
    if (ui.mode === 'page') { if (!$('#tablesec').hidden) lastScroll = window.scrollY; $('#tablesec').hidden = true; window.scrollTo(0, 0); }
    det.innerHTML = ui.render(c); det.hidden = false; document.body.classList.add('detail-open');
    if (ui.mode === 'sheet') {
      const b = det.querySelector('.sheet-body'); if (b) b.scrollTop = 0;
      det.querySelector('.sheet')?.focus();
      // markierte Zelle sichtbar halten
      $('#tablesec td.sel')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    if (t.dataset.act === 'only') { const [, n, f] = location.hash.split('/'); only[type(f)] = !only[type(f)]; route(); }
    if (t.dataset.act === 'close') location.hash = '#/';
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && location.hash.length > 2) location.hash = '#/'; });
  addEventListener('hashchange', route);
  document.addEventListener('DOMContentLoaded', () => {
    $('#roundmeta').textContent = `Stand 20.11.2026 · ${PLAYED * PER} Spiele · Spieltag ${FIRST + PLAYED - 1} von ${FIRST + COUNT - 1}`;
    route();
  });
})();
