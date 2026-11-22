import {
  listRounds, listMembers, getMember, ensureMembers, saveMember, deleteMember,
} from '../db.js';
import { computeOverview, rowOfMember } from '../overview.js';
import { roundCode, roundLabel, normName } from '../halbserie.js';
import { adminGate, adminNav } from './admin.js';
import { pointsCardHtml } from './punkte.js';
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
      <div id="matwrap">${members.length ? '' : '<div class="msg">Noch keine Mitglieder. Lade eine Excel-Datei hoch oder übernimm sie aus vorhandenen Halbserien.</div>'}</div>
    </div>`;

  // Sortierbare Tabelle: Klick auf die Spaltenüberschrift sortiert, nochmaliger Klick kehrt die Richtung um.
  const sort = { key: 'name', dir: 1 };
  const value = (r, key) => (key === 'name' ? r.m.name : key === 'count' ? r.count : key === 'sum' ? r.sum : r.cells[key]?.total ?? null);
  const drawTable = () => {
    const sorted = [...rows].sort((a, b) => {
      const va = value(a, sort.key);
      const vb = value(b, sort.key);
      if (va === null || vb === null) return (va === null) - (vb === null); // "–" immer ans Ende
      const c = typeof va === 'string' ? va.localeCompare(vb, 'de') : va - vb;
      return (c || a.m.name.localeCompare(b.m.name, 'de')) * (c ? sort.dir : 1);
    });
    const th = (key, html, title = '') => `<th class="sortable" data-sort="${key}" title="${esc(title)}">${html}${sort.key === String(key) ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    $('#matwrap').innerHTML = `<div class="scroll"><table class="mat">
      <thead><tr>${th('name', 'Name')}${overview.map((o, i) => th(i, esc(roundCode(o.round)), roundLabel(o.round))).join('')}
        ${th('count', 'Halbserien')}${th('sum', 'Punkte gesamt')}</tr></thead>
      <tbody>${sorted.map(({ m, cells, sum, count }) => `<tr>
        <td><a href="${memberHref(m)}">${esc(m.name)}</a></td>
        ${cells.map((c) => `<td>${c ? `${c.total} <span class="muted">(${c.rank}.)</span>` : '<span class="muted">–</span>'}</td>`).join('')}
        <td>${count}</td><td class="total">${sum}</td></tr>`).join('')}</tbody>
    </table></div>`;
    app.querySelectorAll('th[data-sort]').forEach((h) => h.addEventListener('click', () => {
      const k = h.dataset.sort;
      const key = k === 'name' || k === 'count' || k === 'sum' ? k : Number(k);
      if (String(sort.key) === k) sort.dir = -sort.dir;
      else { sort.key = key; sort.dir = key === 'name' ? 1 : -1; } // Zahlen zuerst absteigend (beste oben)
      drawTable();
    }));
  };
  if (members.length) drawTable();

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

  app.innerHTML = `
    ${adminNav('members')}
    ${flash}
    <p><a href="#/admin/mitglieder">← Alle Mitglieder</a></p>
    <h2>${esc(m.name)}</h2>
    ${pointsCardHtml(played)}
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
