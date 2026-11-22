import { parseWorkbook, mergeParsed } from '../excel.js';
import { planTeams, findNameGroups, mergePlayers } from '../matching.js';
import { parseChronik, renameChronik } from '../chronik.js';
import { fetchTeams } from '../openliga.js';
import { BUNDESLIGA_FALLBACK } from '../teams.js';
import {
  saveRound, addPlayersToRound, deleteRound, listRounds, getSeasonMatches, ensureMembers, listMembers, memberNames,
} from '../db.js';
import { detectHalbserie, nameFromFilename, roundCode, roundLabel, seasonShort, normName } from '../halbserie.js';
import { esc, $ } from '../util.js';

/** Zugriffsschutz für alle Verwaltungsseiten. Gibt true zurück, wenn der Nutzer Admin ist. */
export function adminGate(app, session) {
  if (!session.user) { app.innerHTML = '<div class="msg warn">Bitte oben rechts mit Google anmelden.</div>'; return false; }
  if (!session.isAdmin) {
    app.innerHTML = `<div class="msg err">${esc(session.user.email)} ist nicht als Admin freigeschaltet.
      Lege in Firestore ein Dokument <code>admins/${esc(session.user.email.toLowerCase())}</code> an.</div>
      <div class="row" style="margin-inline:max(16px,env(safe-area-inset-left,0px))"><button data-logout>Abmelden</button></div>`;
    return false;
  }
  return true;
}

export const adminNav = (active) => `<h1>Verwaltung</h1>
  <nav class="tabs"><a href="#/admin" class="${active === 'upload' ? 'active' : ''}">Halbserien &amp; Upload</a>
  <a href="#/admin/mitglieder" class="${active === 'members' ? 'active' : ''}">Mitglieder</a>
  <button class="linkbtn" data-logout>Abmelden</button></nav>`;

export async function renderAdmin(app, session, flash = '') {
  if (!adminGate(app, session)) return;
  const rounds = await listRounds();
  const now = new Date();
  const thisYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  app.innerHTML = `
    ${adminNav('upload')}
    ${flash}
    <div class="card"><h3>Excel hochladen</h3>
      <p class="muted">Eine ganze Tippdatei <em>oder</em> einzelne Arbeitsblätter (je Mitspieler eine Datei, auch mehrere auf einmal).
        Saison und Hin-/Rückrunde werden aus dem Dateinamen erkannt (z. B. „Rückrunde 2526“, „22-23 H“) und können geändert werden.</p>
      <div class="row">
        <input type="file" id="file" accept=".xlsx,.xlsm,.xls" multiple />
      </div>
      <div class="row">
        <label>Saison (Startjahr) <input id="jahr" type="number" value="${thisYear}" style="width:6rem" /></label>
        <label>Typ <select id="typ"><option value="hin">Hinrunde (H)</option><option value="rueck">Rückrunde (R)</option></select></label>
        <label>Ziel <select id="target"></select></label>
        <span class="muted">Benennung: <strong id="code"></strong></span>
      </div>
      <div id="detect"></div>
      <div id="preview"></div>
    </div>
    <div class="card"><h3>Vorhandene Halbserien</h3>
      ${rounds.map((r) => `<div class="row"><a href="#/runde/${esc(r.id)}">${esc(roundLabel(r))} · ${r.playerCount} Mitspieler</a>
        <button data-del="${esc(r.id)}">Löschen</button></div>`).join('') || '<span class="muted">Keine</span>'}
      <div class="row"><button id="refresh">Ergebnisse von OpenLigaDB jetzt aktualisieren</button><span id="refmsg" class="muted"></span></div>
    </div>`;

  let parsed = null;
  const preview = $('#preview');

  // Ziel: vorhandene Halbserie (gleiche Saison + Typ) oder neu anlegen.
  const refreshTarget = () => {
    const jahr = Number($('#jahr').value);
    const typ = $('#typ').value;
    const code = roundCode({ jahr, typ });
    const existing = rounds.find((r) => r.jahr === jahr && r.typ === typ);
    $('#code').textContent = code;
    $('#target').innerHTML = existing
      ? `<option value="${esc(existing.id)}">Zu vorhandener Halbserie ${esc(code)} hinzufügen (${existing.playerCount} Mitspieler)</option>
         <option value="new">Zusätzliche neue Halbserie ${esc(code)} anlegen</option>`
      : `<option value="new">Neue Halbserie ${esc(code)} anlegen</option>`;
  };
  $('#jahr').addEventListener('input', refreshTarget);
  $('#typ').addEventListener('change', refreshTarget);
  refreshTarget();


  /** Chronik-Datei: je Blatt eine Halbserie mit Punkten pro Spieltag (nur Spalten A–S). */
  async function chronikFlow(chronik, filename) {
    const members = await listMembers().catch(() => []);
    // 1) Namen, die schon als Alias eines Mitglieds bekannt sind, auf den Mitgliedsnamen abbilden.
    const aliasMap = {};
    const importNames = [...new Set(chronik.rounds.flatMap((r) => r.players.map((p) => p.name)))];
    for (const n of importNames) {
      const m = members.find((x) => memberNames(x).includes(normName(n)));
      if (m && m.name !== n) aliasMap[n] = m.name;
    }
    const known = new Set(members.map((m) => m.name));
    // 2) Unsichere Fälle: ähnliche Namen in der Datei oder zu vorhandenen Mitgliedern.
    const effective = [...new Set(importNames.map((n) => aliasMap[n] ?? n))];
    const groups = findNameGroups([...new Set([...effective, ...known])], { strict: true })
      .filter((g) => g.some((n) => effective.includes(n)) && !g.every((n) => known.has(n)));

    preview.innerHTML = `
      <div class="msg ok">Chronik-Datei „${esc(filename)}“ erkannt: ${chronik.rounds.length} Halbserien, ${importNames.length} verschiedene Namen.
        Gelesen werden nur die Spalten A–S (Platz, Name, Spieltage 1–17); Gesamt und alles rechts davon wird ignoriert.</div>
      ${[...chronik.warnings, ...(chronik.ignored.length ? [`Übersprungene Blätter: ${chronik.ignored.join(', ')}`] : [])]
        .map((w) => `<div class="msg warn">${esc(w)}</div>`).join('')}
      <h4>Halbserien</h4>
      ${chronik.rounds.map((r, i) => {
        const ex = rounds.find((x) => x.jahr === r.jahr && x.typ === r.typ);
        return `<label style="display:block"><input type="checkbox" data-r="${i}" checked />
          ${esc(roundLabel(r))}${r.liga ? ` · Liga ${r.liga}` : ''} <span class="muted">(Blatt „${esc(r.sheet)}“, ${r.players.length} Mitspieler)</span>
          ${ex ? `<span class="msg warn">Es gibt schon ${esc(roundLabel(ex))} – ${ex.kind === 'chronik' ? 'wird ersetzt' : 'wird als zusätzliche Halbserie angelegt'}</span>` : ''}</label>`;
      }).join('')}
      ${Object.keys(aliasMap).length ? `<h4>Bekannte Schreibweisen (Mitglieder-Aliase)</h4>
        <div class="muted">${Object.entries(aliasMap).map(([a, b]) => `${esc(a)} → ${esc(b)}`).join(' · ')}</div>` : ''}
      ${groups.length ? `<h4>Namen prüfen – gehören diese zusammen?</h4>
        ${groups.map((g, i) => `<div class="card">
          <div>${g.map((n) => `${esc(n)}${known.has(n) ? ' <span class="muted">(Mitglied)</span>' : ''}`).join(' &nbsp;·&nbsp; ')}</div>
          <label style="display:block"><input type="radio" name="cg${i}" value="" checked /> Verschiedene Personen (getrennt lassen)</label>
          <label style="display:block"><input type="radio" name="cg${i}" value="merge" /> Dieselbe Person, zusammenführen als
            <select data-cinto="${i}">${[...g].sort((a, b) => known.has(b) - known.has(a)).map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>
        </div>`).join('')}`
        : '<div class="msg ok">Keine unklaren Namen gefunden.</div>'}
      <div class="row"><button id="cimport">Importieren</button><span id="cmsg"></span></div>`;

    $('#cimport').addEventListener('click', async () => {
      const map = { ...aliasMap };
      const notes = [];
      groups.forEach((g, i) => {
        if ($(`[name="cg${i}"]:checked`)?.value !== 'merge') return;
        const into = $(`[data-cinto="${i}"]`).value;
        for (const n of g) {
          if (n === into) continue;
          for (const [orig, cur] of Object.entries({ ...Object.fromEntries(importNames.map((x) => [x, aliasMap[x] ?? x])) })) {
            if (cur === n) map[orig] = into;
          }
          notes.push(`${n} → ${into}`);
        }
      });
      const warnings = [];
      const chosen = renameChronik(chronik.rounds.filter((_, i) => $(`[data-r="${i}"]`).checked), map, warnings);
      if (!chosen.length) { $('#cmsg').innerHTML = '<span class="msg err">Keine Halbserie ausgewählt.</span>'; return; }
      $('#cimport').disabled = true;
      try {
        for (const r of chosen) {
          const old = rounds.find((x) => x.jahr === r.jahr && x.typ === r.typ && x.kind === 'chronik');
          if (old) await deleteRound(old.id);
          await saveRound({ jahr: r.jahr, typ: r.typ, kind: 'chronik', liga: r.liga, spieltage: r.spieltage, players: r.players });
        }
        const added = await ensureMembers(chosen.flatMap((r) => r.players.map((p) => p.name)));
        renderAdmin(app, session, `<div class="msg ok">${chosen.length} Halbserien aus der Chronik importiert.
          ${added.length ? `Neue Mitglieder (${added.length}): ${added.map(esc).join('; ')}.` : 'Keine neuen Mitglieder.'}
          ${notes.length ? `Zusammengeführt: ${notes.map(esc).join('; ')}.` : ''}
          ${warnings.map(esc).join(' ')}</div>`);
      } catch (err) {
        $('#cmsg').innerHTML = `<span class="msg err">${esc(err.message)}</span>`;
        $('#cimport').disabled = false;
      }
    });
  }

  $('#file').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    if (files.length === 1) {
      let chronik = null;
      try { chronik = parseChronik(new Uint8Array(await files[0].arrayBuffer())); } catch { /* kein lesbares Chronik-Format */ }
      if (chronik) { $('#detect').innerHTML = ''; await chronikFlow(chronik, files[0].name); return; }
    }
    const parts = [];
    const errors = [];
    const sources = []; // { bytes, fallbackName } für das erneute Einlesen mit Umbenennung
    for (const f of files) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const fallbackName = nameFromFilename(f.name);
        parts.push(parseWorkbook(bytes, { fallbackName }));
        sources.push({ bytes, fallbackName });
      } catch (err) {
        errors.push(`${f.name}: ${err.message}`);
      }
    }
    if (!parts.length) {
      preview.innerHTML = errors.map((m) => `<div class="msg err">Datei nicht lesbar: ${esc(m)}</div>`).join('');
      parsed = null;
      return;
    }
    parsed = mergeParsed(parts);

    // Saison/Typ aus den Dateinamen vorbelegen (manuell änderbar)
    const det = files.map((f) => detectHalbserie(f.name));
    const jahre = [...new Set(det.map((d) => d.jahr).filter((j) => j !== null))];
    const typen = [...new Set(det.map((d) => d.typ).filter(Boolean))];
    if (jahre.length) $('#jahr').value = jahre[0];
    if (typen.length) $('#typ').value = typen[0];
    refreshTarget();
    const hints = [];
    if (jahre.length && typen.length) hints.push(`<div class="msg ok">Erkannt aus Dateiname: ${esc(roundCode({ jahr: jahre[0], typ: typen[0] }))} – bitte kurz prüfen.</div>`);
    else hints.push('<div class="msg warn">Saison und/oder Typ konnten nicht eindeutig aus dem Dateinamen erkannt werden – bitte oben auswählen.</div>');
    if (jahre.length > 1 || typen.length > 1) hints.push('<div class="msg warn">Die Dateinamen deuten auf unterschiedliche Halbserien hin – bitte nur Dateien einer Halbserie gemeinsam hochladen.</div>');
    $('#detect').innerHTML = hints.join('');

    // Rückfrage: Vereine mit aktueller Bundesliga abgleichen, Mitspielernamen prüfen.
    let bundesliga = BUNDESLIGA_FALLBACK, teamSource = 'feste Liste (OpenLigaDB nicht erreichbar)';
    try {
      bundesliga = await fetchTeams(Number($('#jahr').value));
      teamSource = `OpenLigaDB, Saison ${$('#jahr').value}`;
    } catch { /* Fallback */ }
    const teamPlan = planTeams(parsed.teams, bundesliga).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const nameGroups = findNameGroups(parsed.players.map((p) => p.name));
    const opts = (sel) => `<option value="">– unverändert lassen –</option>${[...bundesliga].sort((a, b) => a.localeCompare(b, 'de'))
      .map((t) => `<option ${t === sel ? 'selected' : ''}>${esc(t)}</option>`).join('')}`;
    preview.innerHTML = `
      ${errors.map((m) => `<div class="msg err">Datei nicht lesbar: ${esc(m)}</div>`).join('')}
      <div class="msg ok">${parsed.players.length} Spielerblätter gefunden. Bitte Zuordnung prüfen und bestätigen.</div>
      <h4>Vereine → aktuelle Bundesliga <span class="muted">(${esc(teamSource)})</span></h4>
      ${teamPlan.map((t, i) => `<div class="row"><span style="min-width:9rem">${esc(t.name)}</span> →
        <select data-team="${i}">${opts(t.suggestion)}</select>
        ${t.suggestion === null ? '<span class="msg err">Kein Vorschlag – bitte wählen</span>'
          : t.sure ? '' : '<span class="msg warn">Umbenennung vorgeschlagen</span>'}</div>`).join('')}
      ${nameGroups.length ? `<h4>Mitspielernamen – gehören diese zusammen?</h4>
        ${nameGroups.map((g, i) => `<div class="card">
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
      parsed = mergeParsed(sources.map((x) => parseWorkbook(x.bytes, { fallbackName: x.fallbackName, rename })));
      const merged = mergePlayers(parsed.players, merges);
      parsed.players = merged.players;
      merges.forEach((m) => notes.push(`Mitspieler zusammengeführt: ${m.names.join(' + ')} → „${m.into}“`));
      showFinal(errors, [...notes, ...merged.conflicts]);
    });
  });

  function showFinal(errors, notes) {
    preview.innerHTML = `
      ${errors.map((m) => `<div class="msg err">Datei nicht lesbar: ${esc(m)}</div>`).join('')}
      <div class="msg ok">${parsed.players.length} Spielerblätter, ${parsed.order.length} Spiele je Blatt.
        ${parsed.excelResults ? `${parsed.excelResults.length} Ergebnisse im Blatt „Ergebnisse“ (Fallback).` : ''}</div>
      ${[...notes, ...parsed.warnings].map((w) => `<div class="msg warn">${esc(w)}</div>`).join('')}
      <div class="muted">Übersprungene Blätter: ${esc(parsed.ignored.join(', ') || '–')}</div>
      <details ${parsed.players.length <= 10 ? 'open' : ''}><summary>Mitspieler auswählen</summary>${parsed.players.map((p, i) =>
        `<label style="display:block"><input type="checkbox" data-p="${i}" checked /> ${esc(p.name)}
          <span class="muted">(${p.tipCount}/${p.matchCount} Tipps)</span></label>`).join('')}</details>
      <div class="row"><button id="save">Speichern</button><span id="savemsg"></span></div>
      <div class="muted">Bei „Zu vorhandener Halbserie hinzufügen“ werden Mitspieler mit gleichem Namen überschrieben.</div>`;

    $('#save').addEventListener('click', async () => {
      const chosen = parsed.players.filter((_, i) => $(`[data-p="${i}"]`).checked);
      const jahr = Number($('#jahr').value);
      const typ = $('#typ').value;
      if (!chosen.length) { $('#savemsg').innerHTML = '<span class="msg err">Kein Mitspieler ausgewählt.</span>'; return; }
      if (!Number.isInteger(jahr) || jahr < 1990 || jahr > 2100) { $('#savemsg').innerHTML = '<span class="msg err">Ungültige Saison.</span>'; return; }
      $('#save').disabled = true;
      try {
        const target = $('#target').value;
        const code = roundCode({ jahr, typ });
        let id;
        if (target === 'new') {
          id = await saveRound({ jahr, typ, order: parsed.order, excelResults: parsed.excelResults, players: chosen });
        } else {
          id = target;
          await addPlayersToRound(id, { players: chosen, order: parsed.order, excelResults: parsed.excelResults });
        }
        const added = await ensureMembers(chosen.map((p) => p.name));
        const memberMsg = added.length
          ? `Neue Mitglieder (${added.length}): ${added.map(esc).join('; ')}.`
          : 'Keine neuen Mitglieder.';
        renderAdmin(app, session, `<div class="msg ok">${chosen.length} Mitspieler in ${esc(code)} gespeichert.
          ${memberMsg} <a href="#/runde/${esc(id)}">Zur Tabelle</a> · <a href="#/admin/mitglieder">Mitglieder</a></div>`);
      } catch (err) {
        $('#savemsg').innerHTML = `<span class="msg err">${esc(err.message)}</span>`;
        $('#save').disabled = false;
      }
    });
  }

  app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Halbserie wirklich löschen?')) return;
    await deleteRound(b.dataset.del);
    renderAdmin(app, session);
  }));

  $('#refresh').addEventListener('click', async () => {
    $('#refmsg').textContent = 'Lade …';
    try {
      const r = await getSeasonMatches(Number($('#jahr').value), { canWrite: true, force: true });
      $('#refmsg').textContent = `${r.matches.filter((m) => m.finished).length} beendete Spiele (Saison ${seasonShort(Number($('#jahr').value))}) gespeichert.`;
    } catch (err) { $('#refmsg').textContent = err.message; }
  });
}
