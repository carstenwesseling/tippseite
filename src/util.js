export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);

/** Macht alle Tabellen unter `root` per Klick auf die Spaltenüberschrift sortierbar (außer Tabellen mit eigener Sortierung). */
export function enableSort(root) {
  root.querySelectorAll('table').forEach((t) => {
    if (t.querySelector('th[data-sort]') || !t.tBodies[0]) return;
    const ths = [...t.querySelectorAll('thead th')];
    const num = (s) => { const v = parseFloat(String(s).replace(',', '.')); return Number.isNaN(v) ? null : v; };
    ths.forEach((th, i) => {
      th.classList.add('sortable');
      th.addEventListener('click', () => {
        const body = t.tBodies[0];
        const rows = [...body.rows];
        if (!th.dataset.orig) rows.forEach((r, n) => { r.dataset.n = n; });
        const text = rows.some((r) => num(r.cells[i]?.textContent) == null && r.cells[i]?.textContent.trim() !== '·');
        const isText = rows.length && rows.every((r) => num(r.cells[i]?.textContent) == null) && text;
        const first = isText || i === 0 ? 1 : -1; // Text und Rang zuerst aufsteigend, Zahlen absteigend
        const dir = th.dataset.dir ? -th.dataset.dir : first;
        ths.forEach((x) => { delete x.dataset.dir; });
        th.dataset.dir = dir; th.dataset.orig = '1';
        const val = (r) => { const c = r.cells[i]?.textContent.trim() ?? ''; return isText ? c : (num(c) ?? -1); };
        rows.sort((a, b) => {
          const x = val(a), y = val(b);
          const c = isText ? x.localeCompare(y, 'de') : x - y;
          return (c || a.dataset.n - b.dataset.n) * (c ? dir : 1);
        });
        rows.forEach((r) => body.appendChild(r));
      });
    });
  });
}
