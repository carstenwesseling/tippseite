# Tippspiel

Bundesliga-Tippspiel: Excel-Tipps je Halbserie hochladen, Tabelle mit echten Ergebnissen (OpenLigaDB) auswerten.
Punkte: exaktes Ergebnis 2, richtige Tendenz 1.

## Setup
1. Firebase-Projekt anlegen: Authentication → Google aktivieren, Firestore anlegen, Web-App registrieren.
2. `cp .env.example .env` und Werte der Web-App eintragen.
3. Regeln deployen: `npx firebase-tools deploy --only firestore:rules`.
4. In Firestore Dokument `admins/<deine-google-mail-kleingeschrieben>` anlegen (beliebiger Inhalt).
   Optional für einen zweiten Admin (Name + 4-stellige PIN, Verwaltung → Benutzer): in der Firebase-Konsole unter Authentication die Anmeldemethode „E-Mail/Passwort“ aktivieren und die Regeln `firestore.rules` neu veröffentlichen.
5. `npm install && npm run dev`.

## Tipprunde, Mitglieder und Excel-Tippschein
1. **Verwaltung → Tippen → Tipprunde eröffnen**: holt die 153 Paarungen der Halbserie von OpenLigaDB und schaltet `#/tippen` frei.
2. **Verwaltung → Tippen → Tipper**: Haken = tippt mit (vorbelegt mit den Spielern der letzten Halbserie), neue Mitglieder anlegen, je Mitglied „Excel per Mail“ mit Adresse. Adressen liegen in `memberMail` und sind nur für Admins lesbar.
3. Mitglieder wählen im Tippformular ihren Namen und tippen (Entwurf bleibt im Browser, „Abschicken“ speichert in Firestore). Wer „Excel per Mail“ hat, bekommt den Tippschein (eine DIN-A4-Seite, Hochformat, Name oben) als Anhang; zum Herunterladen gibt es den Schein für jeden.
4. **Als Halbserie speichern** beendet die Tipprunde und macht die Tipps zur normalen Halbserie mit Tabelle.

Mailversand: Firebase-Erweiterung „Trigger Email from Firestore“ installieren (Sammlung `mail`, SMTP-Zugang, Blaze-Tarif nötig). Die Regeln lassen nur Mails an die im Admin hinterlegte Adresse eines Mitglieds mit „Excel per Mail“ zu. Ohne die Erweiterung klappt alles außer dem Mailversand (der Download bleibt).
Das Excel-Layout entspricht dem Parser (`src/tipsheet.js`): je Spieltag ein Block, Blattname = Spielername, die Datei lässt sich wieder hochladen.

Die Tipper (`tippers`, `tipperMail`) sind getrennt von den Mitgliedern der Mitgliederverwaltung (`members`); neue Tipper werden dort automatisch ergänzt.

## Nächste Tippfete
**Verwaltung → Tippfete**: Datum, Uhrzeit und Ort (Freitext) eintragen. Die Seite „Nächste Tippfete“ zeigt den Termin als Eintrittskarte. Darunter steht die Umfrage (Komme / Komme nicht, Name aus der aktuellen Halbserie, einmal abstimmen, ohne Anmeldung); die Seite zeigt nur Anzahlen, die Verwaltung die Namen in zwei Listen und kann die Umfrage zurücksetzen. Gespeichert wird in `settings/tippfete`, `settings/tippfeteCounts` und `tippfeteVotes`; dafür müssen die Firestore-Regeln deployt sein (`npx firebase-tools deploy --only firestore:rules`).

## Excel-Format
Je Mitspieler ein Blatt (Name = Blattname). Blöcke mit Kopfzelle `Tipp`; darunter je Spiel `Heim | - | Gast | Tipp H | : | Tipp G`.
Blätter `Namen`, `Ergebnisse`, `aktueller Stand`, `bezahlt…`, `… L2` werden übersprungen. Das Blatt `Ergebnisse` dient als Fallback, falls OpenLigaDB nichts liefert.

## Benennung, Upload, Mitglieder
- Halbserien heißen `25/26 H` (Hinrunde) bzw. `22/23 R` (Rückrunde); in Listen `2025/26 · Rückrunde · 57 Mitspieler`.
- Saison und Typ werden aus dem Dateinamen erkannt (z. B. `rueckrunde2526.xlsm`, `Hinrunde 22-23`, `25_26_R`) und sind änderbar.
- Hochgeladen werden kann eine ganze Datei oder einzelne Arbeitsblätter (mehrere Dateien gleichzeitig). Gibt es die Halbserie schon, werden Mitspieler hinzugefügt bzw. überschrieben. Heißt das Blatt nur „Tabelle1“, wird der Name aus dem Dateinamen genommen.
- Verwaltung → Mitglieder (nur Admins): neue Namen aus Uploads werden automatisch angelegt; Punkteübersicht je Mitglied und Halbserie. Nach Änderung der Regeln `firestore.rules` neu veröffentlichen (Sammlung `members`).

## Veröffentlichen (automatisch)
Jeder Push auf `main` baut und deployt Seite + Firestore-Regeln über `.github/workflows/deploy.yml`. Manuell: GitHub → Actions → Deploy → Run workflow.
Einmalig nötig: GitHub-Repo → Settings → Secrets and variables → Actions, Secrets `FIREBASE_SERVICE_ACCOUNT` (JSON-Schlüssel eines Dienstkontos mit den Rollen „Firebase Admin“ und „Service Usage Consumer“) und die sechs `VITE_FIREBASE_*`-Werte aus `.env.example`.

## Tests
`npm test` (Beispieldatei optional unter `fixtures/rueckrunde2526.xlsm`, nicht eingecheckt).
