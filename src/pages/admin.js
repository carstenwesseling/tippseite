import { parseWorkbook } from '../excel.js';
import { planTeams, findNameGroups, mergePlayers } from '../matching.js';
import { fetchTeams } from '../openliga.js';
import { BUNDESLIGA_FALLBACK } from '../teams.js';
import { saveRound, deleteRound, listRounds, getSeasonMatches } from '../db.js';
import { logout } from '../firebase.js';
import { esc, $ } from '../util.js';

export async function renderAdmin(app, session) {
  if (!session.user) { app.innerHTML = '<div class="msg warn">Bitte oben rechts mit Google anmelden.</div>'; return; }
  if (!session.isAdmin) {
    app.innerHTML = `<div class="msg err">${esc(session.user.email)} ist nicht als Admin freigeschaltet.
      Lege in Firestore ein Dokument <code>admins/${esc(session.user.email.toLowerCase())}</code> an.</div>
      <div class="row" style="margin-inline:max(16px,env(safe-area-inset-left,0px))"><button id="logout">Abmelden</button></div>`;
    $('#logout').addEventListener('click', () => logout());
    return;
  }
  const rounds = await listRounds();
  const thisYear = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  app.innerHTML = `
    <h1>Verwaltung</h1>
    <div class="row" style="margin-inline:max(16px,env(safe-area-inset-left,0px))"><span class="muted">${esc(session.user.email)}</span><button id="logout">Abmelden</button></div>
    <div class="card"><h3>Excel hochladen</h3>
      <div class="row">
        <input type="file" id="file" accept=".xlsx,.xlsm,.xls" />
        <label>Saison (Startjahr) <input id="jahr" type="number" value="${thisYear}" style="width:6rem" /></label>
        <label>Typ <select id="typ"><option value="hin">Hinrunde</option><option value="rueck">Rückrunde</option></select></label>
        <label>Titel <input id="title" placeholder="z. B. Rückrunde 25/26" /></label>
      </div>
      <div id="preview"></div>
    </div>
    <div class="card"><h3>Vorhandene Halbserien</h3>
      ${rounds.map((r) => `<div class="row"><a href="#/runde/${esc(r.id)}">${esc(r.title)}</a>
        <button data-del="${esc(r.id)}">Löschen</button></div>`).join('') || '<span class="muted">Keine</span>'}
      <div class="row"><button id="refresh">Ergebnisse von OpenLigaDB jetzt aktualisieren</button><span id="refmsg" class="muted"></span></div>
    </div>`;

  $('#logout').addEventListener('click', () => logout());

  let parsed = null;
  const preview = $('#preview');

  /** Schritt 2: Ergebnis nach bestätigter Zuordnung anzeigen und speichern. */
  function showFinal(data, f, notes) {
    parsed = data;
    preview.innerHTML = `
      <div class="msg ok">${parsed.players.length} Spielerblätter, ${parsed.order.length} Spiele je Blatt.
        ${parsed.excelResults ? `${parsed.excelResults.length} Ergebnisse im Blatt „Ergebnisse“ (Fallback).` : ''}</div>
      ${[...notes, ...parsed.warnings].map((w) => `<div class="msg warn">${esc(w)}</div>`).join('')}
      <div class="muted">Übersprungene Blätter: ${esc(parsed.ignored.join(', ') || '–')}</div>
      <details><summary>Mitspieler auswählen</summary>${parsed.players.map((p, i) =>
        `<label style="display:block"><input type="checkbox" data-p="${i}" checked /> ${esc(p.name)}
          <span class="muted">(${p.tipCount}/${p.matchCount} Tipps)</span></label>`).join('')}</details>
      <div class="row"><button id="save">Halbserie speichern</button><span id="savemsg"></span></div>`;
    $('#save').addEventListener('click', async () => {
      const chosen = parsed.players.filter((_, i) => $(`[data-p="${i}"]`).checked);
      $('#save').disabled = true;
      try {
        const id = await saveRound({
          title: $('#title').value.trim() || 'Halbserie',
          jahr: Number($('#jahr').value), typ: $('#typ').value,
          order: parsed.order, excelResults: parsed.excelResults, players: chosen,
        });
        location.hash = `#/runde/${id}`;
      } catch (err) {
        $('#savemsg').innerHTML = `<span class="msg err">${esc(err.message)}</span>`;
        $('#save').disabled = false;
      }
    });
  }

  $('#file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    let raw;
    try {
      raw = parseWorkbook(bytes);
    } catch (err) {
      preview.innerHTML = `<div class="msg err">Datei nicht lesbar: ${esc(err.message)}</div>`;
      return;
    }
    if (!$('#title').value) $('#title').value = f.name.replace(/\.[^.]+$/, '');

    // Aktuelle Bundesliga-Vereine: bevorzugt von OpenLigaDB, sonst feste Liste.
    let bundesliga = BUNDESLIGA_FALLBACK, teamSource = 'feste Liste (OpenLigaDB nicht erreichbar)';
    try {
      bundesliga = await fetchTeams(Number($('#jahr').value));
      teamSource = `OpenLigaDB, Saison ${$('#jahr').value}`;
    } catch { /* Fallback */ }

    const teamPlan = planTeams(raw.teams, bundesliga).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const nameGroups = findNameGroups(raw.players.map((p) => p.name));
    const opts = (sel) => `<option value="">– unverändert lassen –</option>${[...bundesliga].sort((a, b) => a.localeCompare(b, 'de'))
      .map((t) => `<option ${t === sel ? 'selected' : ''}>${esc(t)}</option>`).join('')}`;

    preview.innerHTML = `
      <div class="msg ok">${raw.players.length} Spielerblätter gefunden. Bitte Zuordnung prüfen und bestätigen.</div>
      <h4>Vereine → aktuelle Bundesliga <span class="muted">(${esc(teamSource)})</span></h4>
      ${teamPlan.map((t, i) => `<div class="row"><span style="min-width:9rem">${esc(t.name)}</span> →
        <select data-team="${i}">${opts(t.suggestion)}</select>
        ${t.suggestion === null ? '<span class="msg err">Kein Vorschlag – bitte wählen</span>'
          : t.sure ? '' : '<span class="msg warn">Umbenennung vorgeschlagen</span>'}</div>`).join('')}
      ${nameGroups.length ? `<h4>Mitspielernamen – gehören diese zusammen?</h4>
        ${nameGroups.map((g, i) => `<div class="card" data-group="${i}">
          <div>${g.map(esc).join(' &nbsp;·&nbsp; ')}</div>
          <label style="display:block"><input type="radio" name="g${i}" value="" checked /> Verschiedene Personen (getrennt lassen)</label>
          <label style="display:block"><input type="radio" name="g${i}" value="merge" /> Dieselbe Person, zusammenführen als
            <select data-into="${i}">${g.map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>
        </div>`).join('')}` : ''}
      <div class="row"><button id="confirm">Zuordnung bestätigen</button></div>`;

    $('#confirm').addEventListener('click', () => {
      const rename = {}, notes = [];
      teamPlan.forEach((t, i) => {
        const to = $(`[data-team="${i}"]`).value;
        if (to && to !== t.name) { rename[t.name] = to; notes.push(`Verein „${t.name}“ → „${to}“`); }
      });
      const merges = nameGroups.flatMap((g, i) => {
        const sel = $(`[name="g${i}"]:checked`)?.value;
        return sel === 'merge' ? [{ names: g, into: $(`[data-into="${i}"]`).value }] : [];
      });
      const data = parseWorkbook(bytes, { rename });
      const merged = mergePlayers(data.players, merges);
      data.players = merged.players;
      merges.forEach((m) => notes.push(`Mitspieler zusammengeführt: ${m.names.join(' + ')} → „${m.into}“`));
      showFinal(data, f, [...notes, ...merged.conflicts]);
    });
  });

  app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Halbserie wirklich löschen?')) return;
    await deleteRound(b.dataset.del);
    renderAdmin(app, session);
  }));

  $('#refresh').addEventListener('click', async () => {
    $('#refmsg').textContent = 'Lade …';
    try {
      const r = await getSeasonMatches(Number($('#jahr').value), { canWrite: true, force: true });
      $('#refmsg').textContent = `${r.matches.filter((m) => m.finished).length} beendete Spiele gespeichert.`;
    } catch (err) { $('#refmsg').textContent = err.message; }
  });
}
