import {
  listRounds, listMembers, getMember, ensureMembers, saveMember, deleteMember,
} from '../db.js';
import { computeOverview, rowOfMember } from '../overview.js';
import { roundCode, roundLabel, normName } from '../halbserie.js';
import { adminGate, adminNav } from './admin.js';
import { esc, $ } from '../util.js';

const memberHref = (m) => `#/admin/mitglied/${encodeURIComponent(m.id)}`;

/** Übersicht: alle Mitglieder × alle Halbserien (Punkte und Rang). */
export async function renderMembers(app, session, flash = '') {
  if (!adminGate(app, session)) return;
  const [members, rounds] = await Promise.all([listMembers(), listRounds()]);
  const overview = await computeOverview(rounds, { canWrite: true });

  const rows = members.map((m) => {
    const cells = overview.map((o) => rowOfMember(m, o.table));
    const sum = cells.reduce((a, c) => a + (c?.total ?? 0), 0);
    return { m, cells, sum, count: cells.filter(Boolean).length };
  });

  app.innerHTML = `
    ${adminNav('members')}
    ${flash}
    <div class="card"><h3>Mitglieder (${members.length})</h3>
      <div class="row">
        <input id="newname" placeholder="Neues Mitglied, z. B. Meier,H." />
        <button id="add">Hinzufügen</button>
        <button id="sync">Aus allen Halbserien übernehmen</button>
      </div>
      <div class="muted">Neue Namen aus Excel-Uploads werden automatisch ergänzt. Zelle = Punkte (Rang) in der Halbserie.</div>
      ${members.length ? `<div class="scroll"><table class="mat">
        <thead><tr><th>Name</th>${overview.map((o) => `<th title="${esc(roundLabel(o.round))}"><a href="#/runde/${esc(o.round.id)}">${esc(roundCode(o.round))}</a></th>`).join('')}
          <th>Halbserien</th><th>Punkte gesamt</th></tr></thead>
        <tbody>${rows.map(({ m, cells, sum, count }) => `<tr>
          <td><a href="${memberHref(m)}">${esc(m.name)}</a></td>
          ${cells.map((c) => `<td>${c ? `${c.total} <span class="muted">(${c.rank}.)</span>` : '<span class="muted">–</span>'}</td>`).join('')}
          <td>${count}</td><td class="total">${sum}</td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="msg">Noch keine Mitglieder. Lade eine Excel-Datei hoch oder übernimm sie aus vorhandenen Halbserien.</div>'}
    </div>`;

  $('#add').addEventListener('click', async () => {
    const name = $('#newname').value.trim();
    if (!name) return;
    const added = await ensureMembers([name]);
    renderMembers(app, session, added.length
      ? `<div class="msg ok">„${esc(name)}“ hinzugefügt.</div>`
      : `<div class="msg warn">„${esc(name)}“ gibt es schon.</div>`);
  });
  $('#sync').addEventListener('click', async () => {
    const names = overview.flatMap((o) => o.round.players.map((p) => p.name));
    const added = await ensureMembers(names);
    renderMembers(app, session, `<div class="msg ok">${added.length
      ? `${added.length} neue Mitglieder übernommen: ${added.map(esc).join('; ')}.`
      : 'Alle Mitspieler sind schon Mitglieder.'}</div>`);
  });
}

/** Punkteübersicht eines Mitglieds über alle getippten Halbserien + Stammdaten bearbeiten. */
export async function renderMember(app, session, id, flash = '') {
  if (!adminGate(app, session)) return;
  const [m, rounds] = await Promise.all([getMember(id), listRounds()]);
  if (!m) { app.innerHTML = `${adminNav('members')}<div class="msg err">Mitglied nicht gefunden.</div>`; return; }
  const overview = await computeOverview(rounds, { canWrite: true });
  const played = overview.map((o) => ({ o, row: rowOfMember(m, o.table) })).filter((x) => x.row);
  const maxDays = Math.max(0, ...played.map(({ o }) => o.spieltage.length));
  const total = played.reduce((a, { row }) => a + row.total, 0);

  app.innerHTML = `
    ${adminNav('members')}
    ${flash}
    <p><a href="#/admin/mitglieder">← Alle Mitglieder</a></p>
    <h2>${esc(m.name)}</h2>
    <div class="card"><h3>Punkteübersicht</h3>
      ${played.length ? `<div class="scroll"><table class="mat">
        <thead><tr><th>Halbserie</th><th>Rang</th><th>Punkte</th><th>2er</th><th>1er</th><th>Ø</th>
          ${Array.from({ length: maxDays }, (_, i) => `<th>${i + 1}.</th>`).join('')}</tr></thead>
        <tbody>${played.map(({ o, row }) => `<tr>
          <td><a href="#/runde/${esc(o.round.id)}">${esc(roundCode(o.round))}</a> <span class="muted">${esc(roundLabel(o.round))}</span></td>
          <td>${row.rank}. <span class="muted">/ ${o.table.length}</span></td><td class="total">${row.total}</td><td>${row.zwei}</td><td>${row.eins}</td><td>${row.schnitt.toFixed(2)}</td>
          ${Array.from({ length: maxDays }, (_, i) => `<td>${o.spieltage[i] === undefined ? '' : (row.perDay[o.spieltage[i]] ?? 0)}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>
        <p>${played.length} Halbserien · ${total} Punkte insgesamt</p>
        <div class="muted">Spieltagsspalten zeigen die Punkte je Spieltag (bei Ergebnissen aus der Excel-Datei: je Block).</div>`
        : '<div class="msg">Für dieses Mitglied wurden noch keine Tipps gefunden.</div>'}
    </div>
    <div class="card"><h3>Stammdaten</h3>
      <div class="row"><label>Name <input id="mname" value="${esc(m.name)}" style="width:18rem" /></label></div>
      <label class="muted" style="display:block">Weitere Schreibweisen in Excel-Dateien (eine pro Zeile)</label>
      <textarea id="maliases" rows="3" style="width:18rem">${esc((m.aliases ?? []).join('\n'))}</textarea>
      <div class="row"><button id="msave">Speichern</button><button id="mdel">Mitglied löschen</button></div>
      <div class="muted">Wird der Name geändert, bleibt die alte Schreibweise als Alias erhalten, damit die Tipps weiter zugeordnet werden.
        Löschen entfernt nur den Mitgliedseintrag, nicht die Tipps in den Halbserien (beim nächsten Upload wird der Name wieder angelegt).</div>
    </div>`;

  $('#msave').addEventListener('click', async () => {
    const name = $('#mname').value.trim();
    if (!name) return;
    const aliases = $('#maliases').value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (normName(name) !== normName(m.name)) aliases.push(m.name);
    const seen = new Set([normName(name)]);
    const clean = aliases.filter((a) => !seen.has(normName(a)) && seen.add(normName(a)));
    await saveMember(id, { name, aliases: clean });
    renderMember(app, session, id, '<div class="msg ok">Gespeichert.</div>');
  });
  $('#mdel').addEventListener('click', async () => {
    if (!confirm(`Mitglied „${m.name}“ wirklich löschen?`)) return;
    await deleteMember(id);
    location.hash = '#/admin/mitglieder';
  });
}
