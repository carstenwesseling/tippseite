// Verwaltung, Reiter "Tippfete": Datum, Uhrzeit und Ort der nächsten Tippfete.
import { getTippfete, saveTippfete, listVotes, resetVotes } from '../db.js';
import { adminGate, adminNav } from './admin.js';
import { esc, $ } from '../util.js';

export async function renderTippfeteAdmin(app, session, flash = '') {
  if (!adminGate(app, session)) return;
  const t = (await getTippfete().catch(() => null)) ?? {};
  const votes = (await listVotes().catch(() => [])).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const kommt = votes.filter((v) => v.antwort === 'k'), kommtNicht = votes.filter((v) => v.antwort === 'n');
  const list = (arr) => (arr.length ? `<ul>${arr.map((v) => `<li>${esc(v.name)}</li>`).join('')}</ul>` : '<p class="muted">Noch niemand.</p>');
  app.innerHTML = `${adminNav('tippfete')}${flash}
    <div class="card"><h3>Nächste Tippfete</h3>
      <p class="muted">Wird auf der Seite „Nächste Tippfete“ angezeigt. Alle Felder leeren und speichern entfernt den Termin.</p>
      <div class="tfform">
        <label for="tf-d">Datum<input id="tf-d" type="date" value="${esc(t.datum ?? '')}" /></label>
        <label for="tf-t">Uhrzeit<input id="tf-t" type="time" value="${esc(t.uhrzeit ?? '')}" /></label>
        <label for="tf-o">Ort (Freitext)<input id="tf-o" type="text" maxlength="120" value="${esc(t.ort ?? '')}" /></label>
      </div>
      <div class="row"><button id="tf-save">Speichern</button><span id="tf-msg"></span></div></div>
    <div class="card"><h3>Umfrage</h3>
      <div class="tflists"><div><h4>Kommt (${kommt.length})</h4>${list(kommt)}</div><div class="nn"><h4>Kommt nicht (${kommtNicht.length})</h4>${list(kommtNicht)}</div></div>
      <div class="row"><button id="tf-reset"${votes.length ? '' : ' disabled'}>Umfrage zurücksetzen</button><span id="tf-rmsg"></span></div>
      <p class="muted">Zurücksetzen löscht alle Antworten, z. B. vor der nächsten Tippfete.</p></div>`;
  $('#tf-reset').addEventListener('click', async () => {
    if (!confirm('Alle Antworten der Umfrage löschen?')) return;
    $('#tf-reset').disabled = true;
    try { await resetVotes(); renderTippfeteAdmin(app, session, '<div class="msg ok">Umfrage zurückgesetzt.</div>'); }
    catch (e) { $('#tf-rmsg').innerHTML = `<span class="msg err">${esc(e.message)}</span>`; $('#tf-reset').disabled = false; }
  });
  $('#tf-save').addEventListener('click', async () => {
    const datum = $('#tf-d').value, uhrzeit = $('#tf-t').value, ort = $('#tf-o').value.trim();
    if ((uhrzeit || ort) && !datum) { $('#tf-msg').innerHTML = '<span class="msg err">Bitte ein Datum angeben.</span>'; return; }
    $('#tf-save').disabled = true;
    try {
      await saveTippfete({ datum, uhrzeit, ort });
      renderTippfeteAdmin(app, session, '<div class="msg ok">Gespeichert.</div>');
    } catch (e) {
      const denied = /permission/i.test(`${e?.code} ${e?.message}`);
      $('#tf-msg').innerHTML = `<span class="msg err">${denied ? 'Keine Berechtigung: Die Firestore-Regeln (Bereich „settings“) müssen deployt sein.' : esc(e.message)}</span>`;
      $('#tf-save').disabled = false;
    }
  });
}
