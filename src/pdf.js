// PDF der Halbserien-Tabelle (DIN A4 hochkant, eine Seite) nach dem Muster der Excel-Druckvorlage.
const YELLOW = [255, 255, 0], ORANGE = [255, 165, 0], RED = [220, 0, 0];

/**
 * @param {object[]} table Zeilen aus buildTable (name, perDay, total, zwei, eins, rank), nach Rang sortiert
 * @param {number[]} spieltage
 * @param {string} title
 * @returns {Promise<Blob>}
 */
export async function buildTablePdf(table, spieltage, title = '') {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const W = 595.28, H = 841.89, M = 36;
  const dayW = Math.min(24, (W - 2 * M - 30 - 105 - 40 - 2 * 28) / Math.max(1, spieltage.length));
  const cols = { rank: M, name: M + 30, day0: M + 30 + 105 };
  const gesX = cols.day0 + dayW * spieltage.length;
  const x2 = gesX + 44, x1 = x2 + 28, xEnd = x1 + 28;
  const top = M + (title ? 22 : 0);
  const rowH = Math.min(14, (H - M - top) / (table.length + 1));
  const fs = Math.min(9, rowH - 3);

  if (title) { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.text(title, M, M + 8); }
  pdf.setFontSize(fs);
  const dayMax = Object.fromEntries(spieltage.map((d) => [d, Math.max(0, ...table.map((r) => r.perDay[d] ?? 0))]));
  const cell = (text, x, w, y, align = 'center', bold = false, color = [0, 0, 0]) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setTextColor(...color);
    const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - 3 : x + 3;
    pdf.text(String(text), tx, y + rowH - (rowH - fs) / 2 - 1.2, { align });
  };

  // Kopfzeile
  const hy = top;
  pdf.setDrawColor(0); pdf.setLineWidth(0.5);
  spieltage.forEach((d, i) => { cell(d, cols.day0 + i * dayW, dayW, hy, 'center', true); });
  cell('Gesamt', gesX, 44, hy, 'center', true); cell('2er', x2, 28, hy, 'center', true); cell('1er', x1, 28, hy, 'center', true);
  pdf.line(cols.rank, hy + rowH, gesX + 44, hy + rowH); pdf.line(x2, hy + rowH, xEnd, hy + rowH);

  table.forEach((r, i) => {
    const y = top + rowH * (i + 1);
    const fill = i === table.length - 1 && table.length > 3 ? ORANGE : r.rank <= 3 || i < 3 ? YELLOW : null;
    if (fill) { pdf.setFillColor(...fill); pdf.rect(cols.rank, y, gesX + 44 - cols.rank, rowH, 'F'); }
    pdf.setDrawColor(190); pdf.setLineWidth(0.3);
    pdf.line(cols.rank, y + rowH, gesX + 44, y + rowH); pdf.line(x2, y + rowH, xEnd, y + rowH);
    const first = i === 0 || table[i - 1].rank !== r.rank;
    if (first) cell(`${r.rank}.`, cols.rank, 30, y, 'right', true);
    cell(r.name, cols.name, 105, y, 'left');
    spieltage.forEach((d, k) => {
      const v = r.perDay[d] ?? 0;
      const hot = (v > 0 && v === dayMax[d]) || v === 0;
      cell(r.totalOnly ? '' : v, cols.day0 + k * dayW, dayW, y, 'center', false, hot ? RED : [0, 0, 0]);
    });
    cell(r.total, gesX, 44, y, 'center', true);
    cell(r.zwei ?? '', x2, 28, y, 'center'); cell(r.eins ?? '', x1, 28, y, 'center');
  });
  pdf.setTextColor(0);
  return pdf.output('blob');
}
