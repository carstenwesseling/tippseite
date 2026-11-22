# Tippspiel

Bundesliga-Tippspiel: Excel-Tipps je Halbserie hochladen, Tabelle mit echten Ergebnissen (OpenLigaDB) auswerten.
Punkte: exaktes Ergebnis 2, richtige Tendenz 1.

## Setup
1. Firebase-Projekt anlegen: Authentication → Google aktivieren, Firestore anlegen, Web-App registrieren.
2. `cp .env.example .env` und Werte der Web-App eintragen.
3. Regeln deployen: `npx firebase-tools deploy --only firestore:rules`.
4. In Firestore Dokument `admins/<deine-google-mail-kleingeschrieben>` anlegen (beliebiger Inhalt).
5. `npm install && npm run dev`.

## Tipprunde, Mitglieder und Excel-Tippschein
1. **Verwaltung → Tipprunde eröffnen**: holt die 153 Paarungen der Halbserie von OpenLigaDB und schaltet `#/tippen` frei.
2. **Verwaltung → Mitglieder**: Haken = tippt mit (vorbelegt mit den Spielern der letzten Halbserie), neue Mitglieder anlegen, je Mitglied „Excel per Mail“ mit Adresse. Adressen liegen in `memberMail` und sind nur für Admins lesbar.
3. Mitglieder wählen im Tippformular ihren Namen und tippen (Entwurf bleibt im Browser, „Abschicken“ speichert in Firestore). Wer „Excel per Mail“ hat, bekommt den Tippschein (eine DIN-A4-Seite, Hochformat, Name oben) als Anhang; zum Herunterladen gibt es den Schein für jeden.
4. **Als Halbserie speichern** beendet die Tipprunde und macht die Tipps zur normalen Halbserie mit Tabelle.

Mailversand: Firebase-Erweiterung „Trigger Email from Firestore“ installieren (Sammlung `mail`, SMTP-Zugang, Blaze-Tarif nötig). Die Regeln lassen nur Mails an die im Admin hinterlegte Adresse eines Mitglieds mit „Excel per Mail“ zu. Ohne die Erweiterung klappt alles außer dem Mailversand (der Download bleibt).
Das Excel-Layout entspricht dem Parser (`src/tipsheet.js`): je Spieltag ein Block, Blattname = Spielername, die Datei lässt sich wieder hochladen.

## Excel-Format
Je Mitspieler ein Blatt (Name = Blattname). Blöcke mit Kopfzelle `Tipp`; darunter je Spiel `Heim | - | Gast | Tipp H | : | Tipp G`.
Blätter `Namen`, `Ergebnisse`, `aktueller Stand`, `bezahlt…`, `… L2` werden übersprungen. Das Blatt `Ergebnisse` dient als Fallback, falls OpenLigaDB nichts liefert.

## Tests
`npm test` (Beispieldatei optional unter `fixtures/rueckrunde2526.xlsm`, nicht eingecheckt).
