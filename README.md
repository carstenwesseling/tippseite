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

## Tests
`npm test` (Beispieldatei optional unter `fixtures/rueckrunde2526.xlsm`, nicht eingecheckt).
