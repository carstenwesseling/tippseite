// Verwaltung, Reiter "Tippfete": Datum, Uhrzeit und Ort der nächsten Tippfete.
import { getTippfete, saveTippfete } from '../db.js';
import { adminGate, adminNav } from './admin.js';
import { esc, $ } from '../util.js';

export async function renderTippfeteAdmin(app, session, flash = '') {
  if (!adminGate(app, session)) return;
  const t = (await getTippfete().catch(() => null)) ?? {};
  app.innerHTML = `${adminNav('tippfete')}${flash}
    <div class="card"><h3>Nächste Tippfete</h3>
      <p class="muted">Wird auf der Seite „Nächste Tippfete“ angezeigt. Alle Felder leeren und speichern entfernt den Termin.</p>
      <div class="tfform">
        <label for="tf-d">Datum<input id="tf-d" type="date" value="${esc(t.datum ?? '')}" /></label>
        <label for="tf-t">Uhrzeit<input id="tf-t" type="time" value="${esc(t.uhrzeit ?? '')}" /></label>
        <label for="tf-o">Ort (Freitext)<input id="tf-o" type="text" maxlength="120" value="${esc(t.ort ?? '')}" /></label>
      </div>
      <div class="row"><button id="tf-save">Speichern</button><span id="tf-msg"></span></div></div>`;
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
