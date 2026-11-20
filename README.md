# Tippspiel

Bundesliga-Tippspiel: Excel-Tipps je Halbserie hochladen, Tabelle mit echten Ergebnissen (OpenLigaDB) auswerten.
Punkte: exaktes Ergebnis 2, richtige Tendenz 1.

## Setup
1. Firebase-Projekt anlegen: Authentication → Google aktivieren, Firestore anlegen, Web-App registrieren.
2. `cp .env.example .env` und Werte der Web-App eintragen.
3. Regeln deployen: `npx firebase-tools deploy --only firestore:rules`.
4. In Firestore Dokument `admins/<deine-google-mail-kleingeschrieben>` anlegen (beliebiger Inhalt).
5. `npm install && npm run dev`.

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
