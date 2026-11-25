// Verwaltung, Reiter "Benutzer": ein zusätzlicher Admin neben dem Besitzer (Anmeldung mit Name + 4-stelliger PIN). Nur für den Besitzer.
import { getDelegate, saveDelegate, removeDelegate } from '../db.js';
import { createDelegateAccount } from '../firebase.js';
import { adminGate, adminNav } from './admin.js';
import { esc, $ } from '../util.js';

export async function renderBenutzer(app, session, flash = '') {
  if (!adminGate(app, session)) return;
  if (!session.isOwner) { app.innerHTML = `${adminNav('benutzer')}<div class="msg err">Nur der Besitzer verwaltet die Benutzer.</div>`; return; }
  const d = await getDelegate().catch(() => null);
  app.innerHTML = `${adminNav('benutzer')}${flash}
    <div class="card"><h3>Weiterer Admin</h3>
      <p class="muted">Zusätzlich zu dir (Besitzer) kann ein Admin hinterlegt werden. Er darf Excel-Dateien hochladen, Mitglieder hinzufügen,
        eine Tipprunde eröffnen und die Daten unter „Tippfete“ ändern, aber keine Benutzer verwalten und nicht alle Daten löschen.
        Sein Name erscheint beim Klick auf „Anmelden“; er meldet sich mit Name und 4-stelliger PIN an.</p>
      ${d ? `<p>Aktuell hinterlegt: <strong>${esc(d.name)}</strong></p>` : '<p class="muted">Noch kein Admin hinterlegt.</p>'}
      <div class="row">
        <label>Name <input id="u-name" maxlength="24" autocomplete="off" value="${esc(d?.name ?? '')}" style="width:12rem" /></label>
        <label>PIN (4 Ziffern) <input id="u-pin" inputmode="numeric" maxlength="4" pattern="[0-9]*" autocomplete="off" style="width:6rem" /></label>
      </div>
      <div class="row"><button id="u-save">${d ? 'Ersetzen' : 'Speichern'}</button>${d ? '<button id="u-del">Admin entfernen</button>' : ''}<span id="u-msg"></span></div>
      <p class="muted">Eine neue PIN legst du fest, indem du Name und neue PIN speicherst.</p></div>`;
  const err = (e) => { $('#u-msg').innerHTML = `<span class="msg err">${esc(e.message)}</span>`; $('#u-save').disabled = false; };
  $('#u-save').addEventListener('click', async () => {
    const name = $('#u-name').value.trim().replace(/\s+/g, ' '), pin = $('#u-pin').value;
    if (!name) return err(new Error('Bitte einen Namen angeben.'));
    if (!/^\d{4}$/.test(pin)) return err(new Error('Die PIN muss aus genau 4 Ziffern bestehen.'));
    $('#u-save').disabled = true;
    try {
      const email = await createDelegateAccount(name, pin);
      await saveDelegate({ name, email });
      renderBenutzer(app, session, `<div class="msg ok">Gespeichert: ${esc(name)} kann sich jetzt mit der PIN anmelden.</div>`);
    } catch (e) {
      err(/operation-not-allowed/.test(e.code) ? new Error('In der Firebase-Konsole (Authentication) muss „E-Mail/Passwort“ aktiviert sein.') : e);
    }
  });
  $('#u-del')?.addEventListener('click', async () => {
    if (!confirm(`Admin „${d.name}“ entfernen?`)) return;
    try { await removeDelegate(); renderBenutzer(app, session, '<div class="msg ok">Admin entfernt.</div>'); } catch (e) { err(e); }
  });
}
