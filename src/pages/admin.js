import { parseWorkbook, mergeParsed } from '../excel.js';
import { planTeams, findNameGroups, findSpellingVariants, mergePlayers } from '../matching.js';
import { parseChronik, renameChronik } from '../chronik.js';
import { fetchTeams } from '../openliga.js';
import { BUNDESLIGA_FALLBACK } from '../teams.js';
import {
  saveRound, getRound, addPlayersToRound, addStatsToRound, deleteRound, deleteAllData, listRounds, getSeasonMatches, ensureMembers, listMembers, memberNames,
} from '../db.js';
import { detectHalbserie, nameFromFilename, roundCode, roundLabel, sameHalbserie, seasonShort, normName } from '../halbserie.js';
import { buildTable } from '../scoring.js';
import { resolveResults } from './table.js';
import { buildTablePdf } from '../pdf.js';
import { esc, $ } from '../util.js';

/** Zugriffsschutz für alle Verwaltungsseiten. Gibt true zurück, wenn der Nutzer Admin ist. */
let ownerView = false; // Besitzer sieht zusätzlich "Benutzer" und "Alle Daten löschen"
export function adminGate(app, session) {
  ownerView = Boolean(session.isOwner);
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
  <a href="#/admin/tippen" class="${active === 'tippen' ? 'active' : ''}">Tippen</a>
  <a href="#/admin/tippfete" class="${active === 'tippfete' ? 'active' : ''}">Tippfete</a>
  ${ownerView ? `<a href="#/admin/benutzer" class="${active === 'benutzer' ? 'active' : ''}">Benutzer</a>` : ''}
  <button class="linkbtn" data-logout>Abmelden</button></nav>`;

export async function renderAdmin(app, session, flash = '') {
  if (!adminGate(app, session)) return;
  const rounds = await listRounds();
  const now = new Date();
  const thisYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  app.innerHTML = `
    ${adminNav('upload')}
    ${flash}
    <div class="row"><button class="primary" id="pdf"${rounds.length ? '' : ' disabled'}>Aktuelle Halbserie als PDF</button><button class="primary" id="pdfshare"${rounds.length ? '' : ' disabled'}>PDF teilen (WhatsApp)</button><span id="pdfmsg" class="muted"></span></div>
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
      ${rounds.map((r) => `<div class="row${r.liga === 2 ? ' liga2' : ''}"><a href="#/runde/${esc(r.id)}">${esc(roundLabel(r))} · ${r.playerCount} Mitspieler</a>
        <button data-del="${esc(r.id)}">Löschen</button></div>`).join('') || '<span class="muted">Keine</span>'}
      <div class="row"><button id="refresh">Ergebnisse von OpenLigaDB jetzt aktualisieren</button><span id="refmsg" class="muted"></span></div>
    </div>
    ${session.isOwner ? `<div class="card"><h3>Alle Daten löschen</h3>
      <p class="muted">Löscht alle Halbserien samt Mitspielern, alle Mitglieder und die zwischengespeicherten Ergebnisse. Admin-Zugänge bleiben bestehen.
        Das kann nicht rückgängig gemacht werden.</p>
      <div class="row"><label>Zur Bestätigung <strong>LÖSCHEN</strong> eingeben <input id="wipeconfirm" autocomplete="off" style="width:8rem" /></label>
        <button id="wipe" disabled>Alle Daten löschen</button><span id="wipemsg"></span></div>
    </div>` : ''}`;

  let parsed = null;
  const preview = $('#preview');

  // Ziel: vorhandene Halbserie (gleiche Saison + Typ) oder neu anlegen.
  const refreshTarget = () => {
    const jahr = Number($('#jahr').value);
    const typ = $('#typ').value;
    const code = roundCode({ jahr, typ });
    const existing = rounds.find((r) => sameHalbserie(r, { jahr, typ }));
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
  async function chronikFlow(bytes, filename, fixes = null) {
    // Beim ersten Mal die empfohlenen Korrekturen vorauswählen; danach gilt die Auswahl des Nutzers.
    if (!fixes) {
      const first = parseChronik(bytes);
      fixes = Object.fromEntries(first.issues.filter((i) => i.fix && i.recommended).map((i) => [i.sheet, i.fix]));
    }
    const chronik = parseChronik(bytes, { fixes });
    const issueSheets = new Set(chronik.issues.map((i) => i.sheet));
    const skipped = chronik.ignored.filter((n) => !issueSheets.has(n));
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
    // Gleiche Schreibweisen (nur Zeichensetzung/Groß-Kleinschreibung/Leerzeichen anders): je Variante ein Vorschlag, vorausgewählt.
    const counts = new Map();
    for (const r of chronik.rounds) for (const p of r.players) { const c = aliasMap[p.name] ?? p.name; counts.set(c, (counts.get(c) ?? 0) + 1); }
    const variants = findSpellingVariants([...effective, ...known], { known, counts })
      .filter((v) => effective.includes(v.from) && !known.has(v.from));
    const fromSet = new Set(variants.map((v) => v.from));
    const otherGroups = findNameGroups([...new Set([...effective, ...known])].filter((n) => !fromSet.has(n)), { strict: true })
      .filter((g) => g.some((n) => effective.includes(n)) && !g.every((n) => known.has(n)));
    const groups = [...variants.map((v) => [v.from, v.to]), ...otherGroups];
    const pre = new Map(variants.map((v, i) => [i, v.to])); // Gruppe -> vorgeschlagener Zielname

    preview.innerHTML = `
      <div class="msg ok">Chronik-Datei „${esc(filename)}“ erkannt: ${chronik.rounds.length} Halbserien, ${importNames.length} verschiedene Namen.
        Gelesen werden nur die Spalten A–S (Platz, Name, Spieltage 1–17); zusätzlich werden die Spalten „2er“ und „1er“ (erkannt an der Überschrift) übernommen, Gesamt und der Rest rechts davon wird ignoriert.</div>
      ${chronik.issues.length ? `<h4>Fehlerhafte Arbeitsblätter (${chronik.issues.length})</h4>
        <div class="muted">Diese Blätter weichen vom erwarteten Aufbau ab. Mit Haken wird der Korrekturvorschlag beim Import angewendet,
          ohne Haken wird das Blatt übersprungen. Die Excel-Datei selbst bleibt unverändert.</div>
        ${chronik.issues.some((i) => i.kind === 'totals') ? `<div class="row"><button data-allkind="totals">Alle Blätter mit nur Gesamtpunkten ${
          chronik.issues.filter((i) => i.kind === 'totals').every((i) => i.applied) ? 'wieder ausschließen' : 'einbeziehen'}</button></div>` : ''}
        ${chronik.issues.map((i, n) => `<div class="card">
          <strong>${esc(i.sheet)}</strong>
          <div class="msg ${i.applied ? 'ok' : 'warn'}">${esc(i.problem)}</div>
          <div class="muted">Vorschlag: ${esc(i.suggestion)}</div>
          ${i.fix ? `<label style="display:block"><input type="checkbox" data-fix="${n}" ${i.applied ? 'checked' : ''} /> ${esc(i.fixLabel)}${i.applied ? ' – wird angewendet' : ''}</label>`
            : '<div class="muted">Keine automatische Korrektur möglich – Blatt wird übersprungen.</div>'}
        </div>`).join('')}` : ''}
      ${[...chronik.warnings, ...(skipped.length ? [`Übersprungene Blätter: ${skipped.join(', ')}`] : [])]
        .map((w) => `<div class="msg warn">${esc(w)}</div>`).join('')}
      <h4>Halbserien</h4>
      <div class="rlist">${chronik.rounds.map((r, i) => {
        const ex = rounds.find((x) => sameHalbserie(x, r));
        return `<label class="ritem${r.liga === 2 ? ' liga2' : ''}"><input type="checkbox" data-r="${i}" checked />
          <span>${esc(roundLabel(r))} <span class="muted">(Blatt „${esc(r.sheet)}“, ${r.players.length} Mitspieler)</span>
          ${ex ? `<span class="rnote">Es gibt schon ${esc(roundLabel(ex))} – ${ex.kind === 'chronik' ? 'wird ersetzt' : 'wird als zusätzliche Halbserie angelegt'}</span>` : ''}</span></label>`;
      }).join('')}</div>
      ${Object.keys(aliasMap).length ? `<h4>Bekannte Schreibweisen (Mitglieder-Aliase)</h4>
        <div class="muted">${Object.entries(aliasMap).map(([a, b]) => `${esc(a)} → ${esc(b)}`).join(' · ')}</div>` : ''}
      ${groups.length ? `<h4>Namen prüfen – gehören diese zusammen?</h4>
        ${groups.map((g, i) => `<div class="card">
          <div>${g.map((n) => `${esc(n)}${known.has(n) ? ' <span class="muted">(Mitglied)</span>' : ''}`).join(' &nbsp;·&nbsp; ')}</div>
          ${pre.has(i) ? '<div class="muted">Gleiche Schreibweise – Vorschlag:</div>' : ''}
          <label style="display:block"><input type="radio" name="cg${i}" value="" ${pre.has(i) ? '' : 'checked'} /> Verschiedene Personen (getrennt lassen)</label>
          <label style="display:block"><input type="radio" name="cg${i}" value="merge" ${pre.has(i) ? 'checked' : ''} /> Dieselbe Person, zusammenführen als
            <select data-cinto="${i}">${[...g].sort((a, b) => (b === pre.get(i)) - (a === pre.get(i)) || known.has(b) - known.has(a)).map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>
        </div>`).join('')}`
        : '<div class="msg ok">Keine unklaren Namen gefunden.</div>'}
      <div class="row"><button id="cimport">Importieren</button>
        <button id="cstats" title="Trägt nur 2er und 1er bei bereits vorhandenen Chronik-Halbserien ein; Punkte und alles andere bleiben unverändert.">Nur 2er/1er ergänzen</button><span id="cmsg"></span></div>`;

    const withFix = (base, sheet, fix, on) => {
      const next = { ...base };
      const list = new Set([].concat(next[sheet] ?? []));
      if (on) list.add(fix); else list.delete(fix);
      if (list.size) next[sheet] = [...list]; else delete next[sheet];
      return next;
    };
    app.querySelectorAll('[data-fix]').forEach((box) => box.addEventListener('change', () => {
      const i = chronik.issues[Number(box.dataset.fix)];
      chronikFlow(bytes, filename, withFix(fixes, i.sheet, i.fix, box.checked));
    }));
    app.querySelectorAll('[data-allkind]').forEach((btn) => btn.addEventListener('click', () => {
      const tot = chronik.issues.filter((i) => i.kind === 'totals');
      const on = !tot.every((i) => i.applied);
      const next = tot.reduce((acc, i) => withFix(acc, i.sheet, i.fix, on), fixes);
      chronikFlow(bytes, filename, next);
    }));

    $('#cstats').addEventListener('click', async () => {
      const sel = chronik.rounds.filter((_, i) => $(`[data-r="${i}"]`).checked);
      // nur bestehende Chronik-Halbserien mit 2er/1er-Werten; andere (z. B. die laufende Halbserie) bleiben unberührt
      const targets = sel.map((r) => ({ r, ex: rounds.find((x) => sameHalbserie(x, r) && x.kind === 'chronik') }))
        .filter((t) => t.ex && t.r.players.some((p) => typeof p.zwei === 'number' || typeof p.eins === 'number'));
      if (!targets.length) { $('#cmsg').innerHTML = '<span class="msg err">Keine passende, schon vorhandene Halbserie mit 2er/1er-Werten ausgewählt.</span>'; return; }
      $('#cstats').disabled = true; $('#cimport').disabled = true;
      let updated = 0;
      const missing = [];
      try {
        for (const { r, ex } of targets) {
          const res = await addStatsToRound(ex.id, r.players, aliasMap);
          updated += res.updated;
          res.unmatched.forEach((n) => missing.push(`${roundCode(r)}: ${n}`));
        }
        renderAdmin(app, session, `<div class="msg ok">2er/1er bei ${updated} Spielern in ${targets.length} Halbserien ergänzt.
          ${missing.length ? `Nicht zugeordnet (${missing.length}): ${missing.map(esc).join('; ')}.` : ''}</div>`);
      } catch (err) {
        $('#cmsg').innerHTML = `<span class="msg err">${esc(err.message)}</span>`;
        $('#cstats').disabled = false; $('#cimport').disabled = false;
      }
    });

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
      const dup = chosen.find((r, i) => chosen.findIndex((x) => sameHalbserie(x, r)) !== i);
      if (dup) { $('#cmsg').innerHTML = `<span class="msg err">${esc(roundLabel(dup))} kommt mehrfach vor – bitte nur ein Blatt je Halbserie und Liga auswählen (Blattname prüfen, z. B. L1/L2).</span>`; return; }
      $('#cimport').disabled = true;
      try {
        for (const r of chosen) {
          const old = rounds.find((x) => sameHalbserie(x, r) && x.kind === 'chronik');
          if (old) await deleteRound(old.id);
          await saveRound({ jahr: r.jahr, typ: r.typ, kind: 'chronik', liga: r.liga, spieltage: r.spieltage, totalsOnly: r.totalsOnly, players: r.players });
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
      let bytes = null, isChronik = false;
      try {
        bytes = new Uint8Array(await files[0].arrayBuffer());
        isChronik = !!parseChronik(bytes);
      } catch { /* kein lesbares Chronik-Format */ }
      if (isChronik) { $('#detect').innerHTML = ''; await chronikFlow(bytes, files[0].name); return; }
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
    const playerNames = parsed.players.map((p) => p.name);
    const nvariants = findSpellingVariants(playerNames);
    const nFrom = new Set(nvariants.map((v) => v.from));
    const nameGroups = [...nvariants.map((v) => [v.from, v.to]), ...findNameGroups(playerNames.filter((n) => !nFrom.has(n)))];
    const npre = new Map(nvariants.map((v, i) => [i, v.to]));
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
          ${npre.has(i) ? '<div class="muted">Gleiche Schreibweise – Vorschlag:</div>' : ''}
          <label style="display:block"><input type="radio" name="g${i}" value="" ${npre.has(i) ? '' : 'checked'} /> Verschiedene Personen (getrennt lassen)</label>
          <label style="display:block"><input type="radio" name="g${i}" value="merge" ${npre.has(i) ? 'checked' : ''} /> Dieselbe Person, zusammenführen als
            <select data-into="${i}">${[...g].sort((a, b) => (b === npre.get(i)) - (a === npre.get(i))).map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>
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

  if ($('#wipe')) {
  $('#wipeconfirm').addEventListener('input', () => { $('#wipe').disabled = $('#wipeconfirm').value.trim() !== 'LÖSCHEN'; });
  $('#wipe').addEventListener('click', async () => {
    if (!confirm('Wirklich ALLE Daten (Halbserien, Mitspieler, Mitglieder, Ergebnisse) unwiderruflich löschen?')) return;
    $('#wipe').disabled = true;
    $('#wipemsg').textContent = 'Lösche …';
    try {
      const n = await deleteAllData();
      renderAdmin(app, session, `<div class="msg ok">Alle Daten gelöscht: ${n.rounds} Halbserien, ${n.members} Mitglieder, ${n.results} gespeicherte Ergebnis-Saisons.</div>`);
    } catch (err) {
      $('#wipemsg').innerHTML = `<span class="msg err">${esc(err.message)}</span>`;
      $('#wipe').disabled = false;
    }
  });
  }

  // PDF der aktuellsten Halbserie: Download oder Teilen (auf dem Handy z. B. an eine WhatsApp-Gruppe).
  const makePdf = async () => {
    const r = rounds[0];
    const [round, api] = await Promise.all([getRound(r.id), getSeasonMatches(r.jahr, { canWrite: true })]);
    const { spieltage, results } = resolveResults(round, api.matches);
    const blob = await buildTablePdf(buildTable(round.players, results, spieltage), spieltage, roundLabel(r));
    return { blob, name: `Tabelle_${roundCode(r)}.pdf`, title: roundLabel(r) };
  };
  const download = ({ blob, name }) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };
  const pdfAction = (btn, fn) => btn.addEventListener('click', async () => {
    $('#pdfmsg').textContent = 'Erzeuge PDF …';
    try { await fn(await makePdf()); $('#pdfmsg').textContent = ''; }
    catch (e) { $('#pdfmsg').innerHTML = e.name === 'AbortError' ? '' : `<span class="msg err">${esc(e.message)}</span>`; }
  });
  pdfAction($('#pdf'), async (pdf) => download(pdf));
  pdfAction($('#pdfshare'), async (pdf) => {
    const file = new File([pdf.blob], pdf.name, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: pdf.title }); return; }
    download(pdf); // Browser ohne Datei-Teilen (meist Desktop): PDF laden, per Hand in WhatsApp anhängen
    $('#pdfmsg').textContent = 'Dieser Browser kann nicht direkt teilen: PDF wurde geladen, bitte in WhatsApp anhängen.';
  });
  $('#refresh').addEventListener('click', async () => {
    $('#refmsg').textContent = 'Lade …';
    try {
      const r = await getSeasonMatches(Number($('#jahr').value), { canWrite: true, force: true });
      $('#refmsg').textContent = `${r.matches.filter((m) => m.finished).length} beendete Spiele (Saison ${seasonShort(Number($('#jahr').value))}) gespeichert.`;
    } catch (err) { $('#refmsg').textContent = err.message; }
  });
}
