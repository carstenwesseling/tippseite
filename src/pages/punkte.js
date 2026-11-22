import { roundCode, roundLabel } from '../halbserie.js';
import { esc } from '../util.js';

/**
 * Karte "Punkteübersicht" eines Mitglieds über alle getippten Halbserien (Verwaltung und Bestenliste).
 * @param {Array<{o:{round:object,spieltage:number[],table:object[]}, row:object}>} played
 */
export function pointsCardHtml(played) {
  const maxDays = Math.max(0, ...played.map(({ o }) => o.spieltage.length));
  const total = played.reduce((a, { row }) => a + row.total, 0);
  return `<div class="card"><h3>Punkteübersicht</h3>
    ${played.length ? `<div class="scroll"><table class="mat">
      <thead><tr><th>Halbserie</th><th>Rang</th><th>Punkte</th><th>2er</th><th>1er</th><th>Ø</th>
        ${Array.from({ length: maxDays }, (_, i) => `<th>${i + 1}.</th>`).join('')}</tr></thead>
      <tbody>${played.map(({ o, row }) => `<tr>
        <td><a href="#/runde/${esc(o.round.id)}">${esc(roundCode(o.round))}</a> <span class="muted">${esc(roundLabel(o.round))}</span></td>
        <td>${row.rank}. <span class="muted">/ ${o.table.length}</span></td><td class="total">${row.total}</td><td>${row.zwei ?? '–'}</td><td>${row.eins ?? '–'}</td><td>${row.schnitt.toFixed(2)}</td>
        ${Array.from({ length: maxDays }, (_, i) => `<td>${o.spieltage[i] === undefined ? '' : (row.totalOnly ? '-' : (row.perDay[o.spieltage[i]] ?? 0))}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <p>${played.length} Halbserien · ${total} Punkte insgesamt</p>
      <div class="muted">Spieltagsspalten zeigen die Punkte je Spieltag (bei Ergebnissen aus der Excel-Datei: je Block).</div>`
      : '<div class="msg">Für dieses Mitglied wurden noch keine Tipps gefunden.</div>'}
  </div>`;
}
