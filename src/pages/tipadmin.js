// Verwaltung, Reiter "Tippen": Tipprunde (kommende Halbserie) und Tipper (Haken "tippt mit", Excel per Mail, neue Mitglieder).
import {
  listTippers, listTipperMails, listMembers, tippingRoundPlayers, saveTippers, unlockTips, tipperId, listRounds, getRound, ensureMembers,
  getTipping, openTipping, setTippingOpen, listTips, deleteTipping, tippingToRound,
} from '../db.js';
import { adminGate, adminNav } from './admin.js';
import { normName } from '../halbserie.js';
import { tipStatus } from '../tipstatus.js';
import { esc, $ } from '../util.js';

const byName = (a, b) => a.name.localeCompare(b.name, 'de');
const EMAIL = /^\S+@\S+\.\S+$/;

const deniedMsg = (e) => /permission/i.test(e?.code + ' ' + e?.message)
  ? 'Keine Berechtigung. Die Firestore-Regeln sind vermutlich noch nicht eingespielt: npx firebase-tools deploy --only firestore:rules'
  : e.message;

export async function renderTipMembers(host) {
  try { await renderMembersInner(host); } catch (e) {
    console.error(e);
    host.innerHTML = `<div class="card"><h3>Mitglieder</h3><div class="msg err">${esc(deniedMsg(e))}</div></div>`;
  }
}

async function renderMembersInner(host) {
  host.innerHTML = '<div class="card"><h3>Mitglieder</h3><p class="muted">Lade …</p></div>';
  const [saved, mails, rounds, tipping, allMembers] = await Promise.all([listTippers(), listTipperMails().catch(() => ({})), listRounds(), getTipping().catch(() => null), listMembers().catch(() => [])]);
  // Wer hat in der aktuellsten Halbserie mitgetippt? -> Haken vorbelegt
  const latest = rounds.length ? await getRound(rounds[0].id) : null;
  const current = new Set((latest?.players ?? []).map((p) => tipperId(p.name)));
  const tipCount = new Map();
  const tipsOf = new Map(); // Tipps je Mitspieler aus der Tipprunde
  const lockedTips = new Set(); // abgeschickte (gesperrte) Tipps
  if (tipping) (await listTips().catch(() => [])).forEach((t) => { tipsOf.set(t.id, t.tips ?? {}); tipCount.set(t.id, Object.keys(t.tips ?? {}).length); if (t.locked) lockedTips.add(t.id); });

  // Gültige Tipps: abgeschickte Tipps der Tipprunde ODER Tipps der Halbserie in der Datenbank (z. B. per Excel eingelesen)
  const roundPlayers = tipping ? await tippingRoundPlayers(tipping).catch(() => []) : [];
  const statusOf = (m) => tipping ? tipStatus({ name: m.name, tippingTips: tipsOf.get(m.id), roundPlayers, order: tipping.order }) : null;
  const rows = saved.map((m) => ({ id: m.id, name: m.name, aktiv: m.aktiv, sendExcel: !!m.sendExcel, email: mails[m.id] ?? '', aktuell: current.has(m.id), stored: true }));
  // Vorbelegung aus der letzten Halbserie nur beim ersten Mal; danach zählt die gespeicherte Liste (sonst kämen gelöschte Mitglieder zurück)
  for (const p of saved.length ? [] : latest?.players ?? []) {
    const id = tipperId(p.name);
    if (!rows.some((r) => r.id === id)) rows.push({ id, name: p.name, aktiv: true, sendExcel: false, email: '', aktuell: true, stored: false });
  }
  const removed = [];
  const total = tipping?.order?.length ?? 0;

  host.innerHTML = `<div class="card"><h3>Mitglieder der neuen Halbserie</h3>
    <p class="muted">Haken = tippt mit und erscheint in der Namensliste des Tippformulars. Vorbelegt sind alle, die in „${esc(latest?.title ?? 'der letzten Halbserie')}“ mitgetippt haben.
      „Excel per Mail“ = der Tippschein kann nach dem Abschicken als Excel an die hinterlegte Adresse gehen.</p>
    <select id="m-pick" aria-label="Mitglied aus der Mitgliederverwaltung hinzufügen" style="margin:0 0 10px"></select>
    <form class="add" id="m-add" autocomplete="off"><input id="m-name" placeholder="Neues Mitglied, z. B. Sabine" maxlength="30" aria-label="Name des neuen Mitglieds"><button class="primary" type="submit">Hinzufügen</button></form>
    <div class="tools"><button type="button" id="m-cur">Nur letzte Mitspieler</button><button type="button" id="m-all">Alle</button><button type="button" id="m-none">Keine</button>
      <span class="count" style="margin-left:auto"><b id="m-n">0</b> von <span id="m-t">0</span> tippen mit</span></div>
    <div class="muted" id="m-open" role="status"></div>
    <ul class="mlist" id="m-list"></ul>
    <div class="row"><button type="button" class="primary" id="m-save">Mitglieder speichern</button><span id="m-msg" class="muted" role="status"></span></div></div>`;

  const list = $('#m-list'), msg = $('#m-msg');
  const say = (t, err) => { msg.textContent = t; msg.style.color = err ? '#b3261e' : ''; };

  function draw() {
    rows.sort(byName);
    list.innerHTML = rows.map((m, i) => {
      const n = tipCount.get(m.id);
      const badge = !m.stored && !m.aktuell ? '<span class="badge new">neu</span>' : m.aktuell ? '<span class="badge">tippt aktuell mit</span>' : '<span class="badge old">früher</span>';
      const lock = lockedTips.has(m.id) ? '<span class="badge">abgeschickt</span>' : '';
      const st = statusOf(m);
      const progress = !st ? '' : st.state === 'komplett' ? `<span class="badge">✓ vollständig${st.source === 'excel' ? ' (Excel)' : ''}</span>`
        : st.state === 'teilweise' ? `<span class="badge old">unvollständig ${st.count}/${total}</span>` : '<span class="badge new">kein Tipp</span>';
      return `<li class="${m.aktiv ? '' : 'off'}"><div class="mrow">
        <label class="gut"><input type="checkbox" data-a="${i}" ${m.aktiv ? 'checked' : ''} aria-label="${esc(m.name)} tippt mit"><span class="nm">${esc(m.name)}</span>${progress}${lock}${badge}</label>
        <button class="rm" data-rm="${i}" aria-label="${esc(m.name)} aus der Liste löschen" title="Löschen">×</button></div>
        ${lockedTips.has(m.id) ? `<div class="mx gut"><button type="button" data-unlock="${i}">Tipp zum Überschreiben freischalten</button></div>` : ''}
        ${m.aktiv ? `<div class="mx gut"><label class="chk"><input type="checkbox" data-x="${i}" ${m.sendExcel ? 'checked' : ''}> Excel per Mail</label>
          ${m.sendExcel ? `<input type="email" data-e="${i}" value="${esc(m.email)}" placeholder="E-Mail-Adresse" inputmode="email" aria-label="E-Mail-Adresse von ${esc(m.name)}">` : ''}</div>` : ''}</li>`;
    }).join('');
    // Dropdown: Mitglieder der Verwaltung, die noch nicht in dieser Liste stehen
    const have = new Set(rows.map((r) => normName(r.name)));
    const rest = allMembers.filter((m) => !have.has(normName(m.name)));
    $('#m-pick').innerHTML = `<option value="">${rest.length ? 'Mitglied aus der Verwaltung wählen …' : 'Alle Mitglieder sind in der Liste'}</option>${rest.map((m) => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('')}`;
    $('#m-pick').disabled = !rest.length;
    if (tipping) {
      const open = rows.filter((m) => m.aktiv).map((m) => ({ m, st: statusOf(m) })).filter((x) => x.st.state !== 'komplett');
      $('#m-open').innerHTML = open.length
        ? `<b>Noch kein vollständiger Tipp (${open.length}):</b> ${open.map(({ m, st }) => esc(m.name) + (st.count ? ` (${st.count}/${total})` : '')).join('; ')}`
        : '<b>Alle Mitspieler haben einen vollständigen Tipp abgegeben.</b>';
    }
    $('#m-n').textContent = rows.filter((m) => m.aktiv).length; $('#m-t').textContent = rows.length;
  }

  list.addEventListener('change', (e) => {
    const t = e.target;
    syncMails();
    if (t.dataset.a != null) rows[t.dataset.a].aktiv = t.checked;
    else if (t.dataset.x != null) rows[t.dataset.x].sendExcel = t.checked;
    else return;
    draw();
  });
  // Adresse aus dem Feld übernehmen: bei Eingabe, bei Änderung (Autofill/Einfügen lösen oft nur "change" aus) und vor dem Speichern
  const syncMails = () => list.querySelectorAll('input[data-e]').forEach((inp) => { rows[inp.dataset.e].email = inp.value; });
  list.addEventListener('input', (e) => { if (e.target.dataset.e != null) rows[e.target.dataset.e].email = e.target.value; });
  list.addEventListener('focusout', syncMails);
  list.addEventListener('click', async (e) => {
    const u = e.target.dataset.unlock;
    if (u != null) {
      const m = rows[u];
      if (!confirm(`Tipp von ${m.name} freischalten? ${m.name} kann ihn danach erneut ändern und abschicken.`)) return;
      try { await unlockTips(m.id); lockedTips.delete(m.id); say(`Tipp von ${m.name} ist freigeschaltet.`); draw(); } catch (err) { say(err.message, true); }
      return;
    }
    const i = e.target.dataset.rm; if (i == null) return;
    const m = rows[i];
    const hasTips = tipCount.get(m.id) > 0;
    if (!confirm(`„${m.name}“ aus der Mitgliederliste löschen?${hasTips ? ' Bereits abgeschickte Tipps bleiben in der Tipprunde erhalten.' : ''}`)) return;
    if (m.stored) removed.push(m.id);
    rows.splice(i, 1); draw();
    say(`${m.name} entfernt. Mit „Mitglieder speichern“ übernehmen.`);
  });
  $('#m-pick').addEventListener('change', (e) => {
    const name = e.target.value; if (!name) return;
    const id = tipperId(name);
    const gone = removed.indexOf(id); if (gone >= 0) removed.splice(gone, 1);
    rows.push({ id, name, aktiv: true, sendExcel: false, email: '', aktuell: false, stored: false });
    draw(); say(`${name} hinzugefügt. Mit „Mitglieder speichern“ übernehmen.`);
  });
  $('#m-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#m-name').value.trim().replace(/\s+/g, ' ');
    if (!name) { say('Bitte einen Namen eingeben.', true); return; }
    const id = tipperId(name);
    if (rows.some((r) => r.id === id || r.name.toLowerCase() === name.toLowerCase())) { say(`„${name}“ gibt es schon, Haken setzen genügt.`, true); return; }
    const gone = removed.indexOf(id); if (gone >= 0) removed.splice(gone, 1);
    rows.push({ id, name, aktiv: true, sendExcel: false, email: '', aktuell: false, stored: false });
    draw(); $('#m-name').value = ''; say(`${name} angelegt. Mit „Mitglieder speichern“ übernehmen.`);
  });
  $('#m-cur').onclick = () => { rows.forEach((m) => { m.aktiv = m.aktuell; }); draw(); };
  $('#m-all').onclick = () => { rows.forEach((m) => { m.aktiv = true; }); draw(); };
  $('#m-none').onclick = () => { rows.forEach((m) => { m.aktiv = false; }); draw(); };
  $('#m-save').addEventListener('click', async () => {
    syncMails();
    const bad = rows.find((m) => m.aktiv && m.sendExcel && !EMAIL.test(m.email.trim()));
    if (bad) { say(`Für ${bad.name} fehlt eine gültige E-Mail-Adresse (oder „Excel per Mail“ abwählen).`, true); return; }
    $('#m-save').disabled = true; say('Speichere …');
    try {
      await saveTippers(rows.map((m) => ({ ...m, sendExcel: m.aktiv && m.sendExcel })), removed);
      await ensureMembers(rows.map((m) => m.name)).catch(() => {}); // neue Namen auch in die Mitgliederverwaltung
      rows.forEach((m) => { m.stored = true; }); removed.length = 0;
      say(`${rows.filter((m) => m.aktiv).length} Mitglieder tippen mit. Gespeichert.`); draw();
    } catch (err) { say(err.message, true); } finally { $('#m-save').disabled = false; }
  });
  draw();
}

export async function renderTipping(host, onChange) {
  let t;
  try { t = await getTipping(); } catch (e) {
    host.innerHTML = `<div class="card"><h3>Tipprunde</h3><div class="msg err">${esc(deniedMsg(e))}</div></div>`;
    return;
  }
  const now = new Date();
  const thisYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const title = (typ, jahr) => `${typ === 'hin' ? 'Hinrunde' : 'Rückrunde'} ${String(jahr).slice(2)}/${String(+jahr + 1).slice(2)}`;

  if (!t) {
    host.innerHTML = `<div class="card"><h3>Tipprunde eröffnen</h3>
      <p class="muted">Holt die 153 Spielpaarungen der Halbserie von OpenLigaDB und schaltet das Tippformular frei.</p>
      <div class="row"><label>Saison (Startjahr) <input id="t-jahr" type="number" value="${thisYear}" style="width:6rem"></label>
        <label>Typ <select id="t-typ"><option value="rueck">Rückrunde</option><option value="hin">Hinrunde</option></select></label></div>
      <div class="row"><button class="primary" id="t-open">Tipprunde eröffnen</button><span id="t-msg" class="muted" role="status"></span></div></div>`;
    $('#t-open').addEventListener('click', async () => {
      const jahr = Number($('#t-jahr').value), typ = $('#t-typ').value;
      $('#t-open').disabled = true; $('#t-msg').textContent = 'Lade Spielplan …';
      try { await openTipping({ title: title(typ, jahr), jahr, typ }); onChange(); }
      catch (e) { $('#t-msg').textContent = e.message; $('#t-open').disabled = false; }
    });
    return;
  }

  const tips = await listTips().catch(() => []);
  const full = tips.filter((p) => Object.keys(p.tips ?? {}).length >= t.order.length).length;
  host.innerHTML = `<div class="card"><h3>Tipprunde: ${esc(t.title)}</h3>
    <p>Status: <strong>${t.open ? 'offen' : 'geschlossen'}</strong> · ${tips.length} Mitglieder haben abgeschickt, ${full} davon vollständig.</p>
    <div class="row"><a class="linkbtn" href="#/tippen" style="text-decoration:underline">Zum Tippformular</a>
      <button id="t-toggle">${t.open ? 'Tipprunde schließen' : 'Tipprunde wieder öffnen'}</button></div>
    <div class="row"><button class="primary" id="t-round" ${tips.length ? '' : 'disabled'}>Als Halbserie speichern</button>
      <button id="t-drop">Tipprunde verwerfen</button><span id="t-msg" class="muted" role="status"></span></div>
    <p class="muted">„Als Halbserie speichern“ beendet die Tipprunde: alle abgeschickten Tipps werden zur Halbserie mit Tabelle.</p></div>`;
  $('#t-toggle').addEventListener('click', async () => { await setTippingOpen(!t.open); onChange(); });
  $('#t-round').addEventListener('click', async () => {
    if (!confirm(`„${t.title}“ als Halbserie speichern? Die Tipprunde wird dabei beendet.`)) return;
    $('#t-msg').textContent = 'Speichere …';
    try { const id = await tippingToRound(t); location.hash = `#/runde/${id}`; } catch (e) { $('#t-msg').textContent = e.message; }
  });
  $('#t-drop').addEventListener('click', async () => {
    if (!confirm('Tipprunde samt aller abgeschickten Tipps wirklich verwerfen?')) return;
    await deleteTipping(); onChange();
  });
}

/** Reiter "Tippen" der Verwaltung. */
export async function renderTipAdmin(app, session) {
  if (!adminGate(app, session)) return;
  app.innerHTML = `${adminNav('tippen')}<div id="tipping"></div><div id="tippers"></div>`;
  const showTipping = () => renderTipping($('#tipping'), () => { showTipping(); renderTipMembers($('#tippers')); });
  showTipping();
  renderTipMembers($('#tippers'));
}
