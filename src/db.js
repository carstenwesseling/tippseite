import {
  collection, doc, deleteField, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, query, where, runTransaction,
} from 'firebase/firestore';
import { db } from './firebase.js';
import { clearCache } from './cache.js';
import { fetchSeason } from './openliga.js';
import { roundCode, compareRounds, normName, samePerson, isPlaceholder } from './halbserie.js';

const STALE_MS = 15 * 60 * 1000;

// ---- Admin ----
/** Admin-Eintrag des Nutzers: null = kein Admin; sonst { owner, name }. Ein Eintrag mit `delegate: true` ist der zusätzliche Admin. */
export async function getAdminInfo(user) {
  if (!user?.email) return null;
  try {
    const s = await getDoc(doc(db, 'admins', user.email.toLowerCase()));
    return s.exists() ? { owner: !s.data().delegate, name: s.data().name ?? '' } : null;
  } catch {
    return null;
  }
}
export const checkAdmin = async (user) => Boolean(await getAdminInfo(user));

// settings/delegate: { name, email } öffentlich lesbar (Name erscheint beim Anmelden); admins/<email>: { delegate: true, name }.
const DELEGATE = () => doc(db, 'settings', 'delegate');
export async function getDelegate() {
  const s = await getDoc(DELEGATE());
  return s.exists() && s.data().name ? s.data() : null;
}
export async function saveDelegate({ name, email }) {
  const old = await getDelegate();
  await setDoc(doc(db, 'admins', email), { delegate: true, name });
  await setDoc(DELEGATE(), { name, email });
  if (old?.email && old.email !== email) await deleteDoc(doc(db, 'admins', old.email));
}
export async function removeDelegate() {
  const old = await getDelegate();
  if (old?.email) await deleteDoc(doc(db, 'admins', old.email));
  await deleteDoc(DELEGATE());
}

// ---- Halbserien ----
export async function listRounds() {
  const snap = await getDocs(collection(db, 'rounds'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(compareRounds);
}

export async function getRound(id) {
  const r = await getDoc(doc(db, 'rounds', id));
  if (!r.exists()) return null;
  const ps = await getDocs(collection(db, 'rounds', id, 'players'));
  return { id, ...r.data(), players: ps.docs.map((d) => d.data()).filter((p) => !isPlaceholder(p.name)).map((p) => ({ ...p, name: samePerson(p.name) })) };
}

/** Speichert eine Halbserie samt Spielern (Batches à max. 400 Schreibvorgänge). */
export async function saveRound({ jahr, typ, order, excelResults, players, kind, liga, spieltage, totalsOnly }) {
  clearCache();
  const ref = doc(collection(db, 'rounds'));
  await setDoc(ref, {
    title: roundCode({ jahr, typ, liga }), jahr, typ, order: order ?? [], excelResults: excelResults ?? [],
    playerCount: players.length, createdAt: Date.now(),
    ...(kind ? { kind } : {}), ...(liga ? { liga } : {}), ...(spieltage ? { spieltage } : {}), ...(totalsOnly ? { totalsOnly: true } : {}),
  });
  await writePlayers(ref.id, players);
  return ref.id;
}

/**
 * Speichert die fertige Tabelle einer abgeschlossenen Halbserie (`summary`: [{ n: Name, t: Punkte, r: Rang }, …]; Firestore kennt keine verschachtelten Arrays) im Halbserien-Dokument.
 * Die Bestenliste liest dann nur noch die Halbserien-Dokumente statt aller Spieler und Ergebnisse.
 */
export async function saveRoundSummary(id, rows) {
  await updateDoc(doc(db, 'rounds', id), { summary: rows.map((r) => ({ n: r.name, t: r.total, r: r.rank })) });
}

async function writePlayers(roundId, players) {
  for (let i = 0; i < players.length; i += 400) {
    const batch = writeBatch(db);
    for (const p of players.slice(i, i + 400)) {
      batch.set(doc(db, 'rounds', roundId, 'players', encodeURIComponent(p.name)), { name: p.name, tips: p.tips ?? {}, ...(p.perDay ? { perDay: p.perDay } : {}), ...(typeof p.zwei === 'number' ? { zwei: p.zwei } : {}), ...(typeof p.eins === 'number' ? { eins: p.eins } : {}), ...(typeof p.total === 'number' ? { total: p.total } : {}) });
    }
    await batch.commit();
  }
}

/**
 * Ergänzt bei bestehenden Spielern einer Halbserie nur die Werte 2er/1er (alles andere bleibt unverändert).
 * Zuordnung über den Namen (Schreibweise egal, bekannte Namensvarianten und `alias`-Zuordnung berücksichtigt).
 * @param {Array<{name:string,zwei?:number,eins?:number}>} rows
 * @param {Record<string,string>} alias Dateiname -> Mitgliedsname
 * @returns {Promise<{updated:number, unmatched:string[]}>}
 */
export async function addStatsToRound(roundId, rows, alias = {}) {
  clearCache();
  const snap = await getDocs(collection(db, 'rounds', roundId, 'players'));
  await updateDoc(doc(db, 'rounds', roundId), { summary: deleteField() });
  const byName = new Map(snap.docs.map((d) => [normName(samePerson(d.data().name)), d.ref]));
  const ops = [];
  const unmatched = [];
  for (const r of rows) {
    const ref = byName.get(normName(samePerson(r.name))) ?? byName.get(normName(samePerson(alias[r.name] ?? '')));
    const upd = {};
    if (typeof r.zwei === 'number') upd.zwei = r.zwei;
    if (typeof r.eins === 'number') upd.eins = r.eins;
    if (!Object.keys(upd).length) continue;
    if (!ref) { unmatched.push(r.name); continue; }
    ops.push([ref, upd]);
  }
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(([ref, upd]) => batch.update(ref, upd));
    await batch.commit();
  }
  return { updated: ops.length, unmatched };
}

/**
 * Fügt Mitspieler (z. B. einzeln hochgeladene Blätter) einer bestehenden Halbserie hinzu.
 * Gleichnamige Mitspieler werden überschrieben. Spielplan/Fallback-Ergebnisse werden nur ergänzt, wenn leer.
 */
export async function addPlayersToRound(roundId, { players, order, excelResults }) {
  clearCache();
  const ref = doc(db, 'rounds', roundId);
  const round = await getDoc(ref);
  if (!round.exists()) throw new Error('Halbserie nicht gefunden.');
  await writePlayers(roundId, players);
  const count = (await getDocs(collection(db, 'rounds', roundId, 'players'))).size;
  const patch = { playerCount: count, summary: deleteField() };
  const r = round.data();
  if (!r.order?.length && order?.length) patch.order = order;
  if (!r.excelResults?.length && excelResults?.length) patch.excelResults = excelResults;
  await updateDoc(ref, patch);
  return count;
}

export async function deleteRound(id) {
  clearCache();
  const ps = await getDocs(collection(db, 'rounds', id, 'players'));
  for (let i = 0; i < ps.docs.length; i += 400) {
    const batch = writeBatch(db);
    ps.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await deleteDoc(doc(db, 'rounds', id));
}

/**
 * Löscht alle Daten: Halbserien samt Mitspielern, Mitglieder und den Ergebnis-Cache.
 * Admin-Einträge bleiben erhalten. Gibt die Anzahl gelöschter Halbserien/Mitglieder zurück.
 */
export async function deleteAllData() {
  clearCache();
  const rounds = await listRounds();
  for (const r of rounds) await deleteRound(r.id);
  const members = await getDocs(collection(db, 'members'));
  const results = await getDocs(collection(db, 'results'));
  const rest = [...members.docs, ...results.docs];
  for (let i = 0; i < rest.length; i += 400) {
    const batch = writeBatch(db);
    rest.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  return { rounds: rounds.length, members: members.size, results: results.size };
}

// ---- Ergebnisse (Cache in Firestore, Quelle OpenLigaDB) ----
/**
 * Liefert die Spiele einer Saison. Frischer Cache -> Cache; sonst API.
 * Schreiben in den Cache nur, wenn `canWrite` (Admin) – Besucher nutzen die API-Daten nur im Speicher.
 */
export async function getSeasonMatches(jahr, { canWrite = false, force = false, live = false } = {}) {
  const ref = doc(db, 'results', String(jahr));
  let cached = null;
  try {
    const s = await getDoc(ref);
    if (s.exists()) cached = s.data();
  } catch { /* Cache optional */ }
  // live: laufender Spieltag – kurzer Cache (45 s), damit ein Minutentakt tatsächlich frische Daten holt
  const maxAge = live ? 45 * 1000 : STALE_MS;
  if (cached && !force && Date.now() - cached.updatedAt < maxAge) return { ...cached, source: 'cache' };
  try {
    const matches = await fetchSeason(jahr);
    const fresh = { matches, updatedAt: Date.now() };
    if (canWrite) { clearCache(); await setDoc(ref, fresh); }
    return { ...fresh, source: 'live' };
  } catch (e) {
    if (cached) return { ...cached, source: 'cache (API nicht erreichbar)', error: e.message };
    throw e;
  }
}

// ---- Mitglieder (nur Admins) ----
// members/{id}: { name, aliases: [Schreibweisen in Excel-Dateien], createdAt }
export const memberId = (name) => encodeURIComponent(normName(name));
export const memberNames = (m) => [m.name, ...(m.aliases ?? [])].map(normName);

export async function listMembers() {
  const snap = await getDocs(collection(db, 'members'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => !isPlaceholder(m.name)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export async function getMember(id) {
  const s = await getDoc(doc(db, 'members', id));
  return s.exists() ? { id, ...s.data() } : null;
}

/** Legt Mitglieder für alle noch unbekannten Namen an (Vergleich ohne Groß-/Kleinschreibung und über Aliase). */
export async function ensureMembers(names) {
  const members = await listMembers();
  const known = new Set(members.flatMap(memberNames));
  const added = [];
  for (const raw of names) {
    const name = raw.trim();
    const n = normName(name);
    if (!n || known.has(n)) continue;
    known.add(n);
    added.push(name);
  }
  for (let i = 0; i < added.length; i += 400) {
    const batch = writeBatch(db);
    for (const name of added.slice(i, i + 400)) {
      batch.set(doc(db, 'members', memberId(name)), { name, aliases: [], createdAt: Date.now() });
    }
    await batch.commit();
  }
  return added;
}

export async function saveMember(id, { name, aliases }) {
  await updateDoc(doc(db, 'members', id), { name, aliases });
}

export const deleteMember = (id) => deleteDoc(doc(db, 'members', id));

// ---- Mitspieler der Tipprunde ("Tipper") ----
// tippers/{id}: { name, aktiv, sendExcel } öffentlich lesbar (Namensliste im Tippformular); tipperMail/{id}: { email } nur für Admins.
// Getrennt von `members` (Stammdaten/Aliase der Mitgliederverwaltung); neue Tipper werden dort per ensureMembers ergänzt.
export const tipperId = (name) => encodeURIComponent(name.trim());

export async function listTippers({ onlyActive = false } = {}) {
  const ref = collection(db, 'tippers');
  const snap = await getDocs(onlyActive ? query(ref, where('aktiv', '==', true)) : ref);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => !isPlaceholder(m.name)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Nur Admins: hinterlegte Mailadressen (id -> Adresse). */
export async function listTipperMails() {
  const snap = await getDocs(collection(db, 'tipperMail'));
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data().email]));
}

/** rows: { name, aktiv, sendExcel, email }; removed: Mitglieds-IDs, die gelöscht werden. */
export async function saveTippers(rows, removed = []) {
  const ops = [];
  for (const r of rows) {
    const id = tipperId(r.name);
    ops.push((b) => b.set(doc(db, 'tippers', id), { name: r.name.trim(), aktiv: !!r.aktiv, sendExcel: !!r.sendExcel }));
    if (r.sendExcel && r.email) ops.push((b) => b.set(doc(db, 'tipperMail', id), { email: r.email.trim() }));
    else ops.push((b) => b.delete(doc(db, 'tipperMail', id)));
  }
  for (const id of removed) {
    ops.push((b) => b.delete(doc(db, 'tippers', id)));
    ops.push((b) => b.delete(doc(db, 'tipperMail', id)));
  }
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach((op) => op(batch));
    await batch.commit();
  }
}

// ---- Tipprunde (kommende Halbserie, in der getippt wird) ----
// tipping/current: { title, jahr, typ, first, order:[{key,spieltag,home,away,date}], open, createdAt }
// tipping/current/tips/{memberId}: { name, tips:{ matchKey: {h,g} }, updatedAt }
const TIPPING = () => doc(db, 'tipping', 'current');

export async function getTipping() {
  const s = await getDoc(TIPPING());
  return s.exists() ? s.data() : null;
}

/** Spiele der Halbserie aus OpenLigaDB holen und die Tipprunde eröffnen. */
export async function openTipping({ title, jahr, typ }) {
  const first = typ === 'hin' ? 1 : 18;
  const all = await fetchSeason(jahr);
  const order = all.filter((m) => m.spieltag >= first && m.spieltag < first + 17)
    .sort((a, b) => a.spieltag - b.spieltag || String(a.date).localeCompare(String(b.date)))
    .map(({ key, spieltag, home, away, date }) => ({ key, spieltag, home, away, date }));
  if (order.length !== 153) throw new Error(`OpenLigaDB liefert ${order.length} statt 153 Spielen für ${typ === 'hin' ? 'die Hinrunde' : 'die Rückrunde'} ${jahr}/${String(jahr + 1).slice(2)}.`);
  const starts = order.map((m) => Date.parse(m.date)).filter(Number.isFinite);
  // firstStart: ab diesem Zeitpunkt (erstes Spiel) sind Tipps und Austragen gesperrt (auch in den Firestore-Regeln)
  await setDoc(TIPPING(), { title, jahr, typ, first, order, open: true, createdAt: Date.now(), ...(starts.length ? { firstStart: Math.min(...starts) } : {}) });
}

export const setTippingOpen = (open) => setDoc(TIPPING(), { open }, { merge: true });

export async function getTips(id) {
  const s = await getDoc(doc(db, 'tipping', 'current', 'tips', id));
  return s.exists() ? s.data() : null;
}

/** Abschicken speichert dauerhaft (locked): Besucher können den Tipp danach nicht mehr überschreiben. */
export const saveTips = (id, name, tips) =>
  setDoc(doc(db, 'tipping', 'current', 'tips', id), { name, tips, updatedAt: Date.now(), locked: true });

/** Nur Admins: Tipp zum Überschreiben freigeben. */
export const unlockTips = (id) => setDoc(doc(db, 'tipping', 'current', 'tips', id), { locked: false }, { merge: true });

/** Nur Admins. */
export async function listTips() {
  const snap = await getDocs(collection(db, 'tipping', 'current', 'tips'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function deleteTipping() {
  const tips = await listTips();
  for (let i = 0; i < tips.length; i += 400) {
    const batch = writeBatch(db);
    tips.slice(i, i + 400).forEach((t) => batch.delete(doc(db, 'tipping', 'current', 'tips', t.id)));
    await batch.commit();
  }
  await deleteDoc(TIPPING());
}

/** Beendet die Tipprunde: wird zur normalen Halbserie (Tabelle), die Tipps wandern mit. */
export async function tippingToRound(t) {
  const active = new Set((await listTippers({ onlyActive: true })).map((m) => m.id));
  const tips = (await listTips()).filter((p) => active.has(p.id)); // ausgetragene Mitspieler zählen nicht
  const players = tips.map((p) => ({
    name: p.name,
    tips: Object.fromEntries(Object.entries(p.tips ?? {}).filter(([, v]) => Number.isFinite(v?.h) && Number.isFinite(v?.g))),
  }));
  const id = await saveRound({
    jahr: t.jahr, typ: t.typ, excelResults: [], players,
    order: t.order.map((o) => ({ block: o.spieltag - t.first + 1, home: o.home, away: o.away, key: o.key })),
  });
  await deleteTipping();
  return id;
}

/** Excel-Tippschein per Mail: Dokument für die Firebase-Erweiterung "Trigger Email from Firestore" (Sammlung `mail`). */
/** Mitspieler trägt seine Adresse selbst ein: setzt "Excel per Mail" und hinterlegt die Adresse (Verwaltung → Tippen). */
export async function registerExcelMail(id, email) {
  await setDoc(doc(db, 'tipperMail', id), { email });
  await updateDoc(doc(db, 'tippers', id), { sendExcel: true });
}
/** "Ich möchte nicht mehr mittippen": nimmt den Mitspieler aus der Tipperliste der Halbserie (Haken in der Verwaltung entfällt). */
export const withdrawTipper = (id) => updateDoc(doc(db, 'tippers', id), { aktiv: false });

/** Spieler der Halbserie in der Datenbank, die zur Tipprunde gehört (z. B. per Excel eingelesen). */
export async function tippingRoundPlayers(t) {
  const r = (await listRounds()).find((x) => x.jahr === t.jahr && x.typ === t.typ && !x.liga);
  return r ? (await getRound(r.id)).players : [];
}
export const queueExcelMail = ({ tipperId: id, to, subject, text, filename, base64 }) =>
  addDoc(collection(db, 'mail'), {
    tipperId: id, to: [to],
    message: { subject, text, attachments: [{ filename, content: base64, encoding: 'base64' }] },
  });

// ---- Nächste Tippfete ----
// settings/tippfete: { datum: 'YYYY-MM-DD', uhrzeit: 'HH:MM', ort: Freitext } öffentlich lesbar, schreiben nur Admins.
const TIPPFETE = () => doc(db, 'settings', 'tippfete');

export async function getTippfete() {
  const s = await getDoc(TIPPFETE());
  const d = s.exists() ? s.data() : null;
  return d?.datum ? d : null;
}

/** Speichert den Termin; ohne Datum, Uhrzeit und Ort wird er entfernt. */
export async function saveTippfete({ datum, uhrzeit, ort }) {
  if (!datum && !uhrzeit && !ort) { await deleteDoc(TIPPFETE()); return; }
  await setDoc(TIPPFETE(), { datum: datum ?? '', uhrzeit: uhrzeit ?? '', ort: (ort ?? '').trim(), updatedAt: Date.now() });
  if (!(await getDoc(COUNTS())).exists()) await setDoc(COUNTS(), { k: 0, n: 0, last: '' }); // Zähler der Umfrage anlegen
}

// ---- Umfrage zur Tippfete ----
// settings/tippfeteCounts: { k, n, last } öffentlich lesbar (nur Anzahlen); tippfeteVotes/{id}: { name, antwort: 'k'|'n', at }
// nur für Admins listbar (Namen). Eine Stimme kann geändert werden (Komme <-> Komme nicht); der Zähler wird passend angepasst.
const COUNTS = () => doc(db, 'settings', 'tippfeteCounts');
const VOTES = 'tippfeteVotes';
export const voteId = (name) => encodeURIComponent(normName(name));

export async function getTippfeteCounts() {
  const s = await getDoc(COUNTS());
  return s.exists() ? { k: s.data().k ?? 0, n: s.data().n ?? 0 } : { k: 0, n: 0 };
}

/** Bisherige Antwort dieses Mitglieds ('k' | 'n') oder null, wenn noch nicht abgestimmt. */
export async function getVote(name) {
  const s = await getDoc(doc(db, VOTES, voteId(name)));
  return s.exists() ? s.data().antwort : null;
}

/** Stimme abgeben oder ändern ('k' = kommt, 'n' = kommt nicht): Stimme und Zähler in einer Transaktion. */
export async function voteTippfete(name, antwort) {
  if (!['k', 'n'].includes(antwort)) throw new Error('Ungültige Antwort');
  const id = voteId(name);
  const vref = doc(db, VOTES, id);
  await runTransaction(db, async (tx) => {
    const old = await tx.get(vref);
    const prev = old.exists() ? old.data().antwort : null;
    if (prev === antwort) return; // unverändert
    const c = (await tx.get(COUNTS())).data() ?? { k: 0, n: 0 };
    const d = (a) => (antwort === a ? 1 : 0) - (prev === a ? 1 : 0);
    if (prev) tx.update(vref, { antwort, at: Date.now() });
    else tx.set(vref, { name, antwort, at: Date.now() });
    tx.update(COUNTS(), { k: (c.k ?? 0) + d('k'), n: (c.n ?? 0) + d('n'), last: id });
  });
}

/** Nur Admins: alle Stimmen mit Namen. */
export async function listVotes() {
  const snap = await getDocs(collection(db, VOTES));
  return snap.docs.map((d) => d.data());
}

/** Nur Admins: Umfrage zurücksetzen (z. B. für die nächste Tippfete). */
export async function resetVotes() {
  const snap = await getDocs(collection(db, VOTES));
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await setDoc(COUNTS(), { k: 0, n: 0, last: '' });
}

/** Mitglieder der aktuellen (neuesten) Halbserie: Namen, die abstimmen dürfen. */
export async function currentMembers() {
  const rounds = (await listRounds()).sort(compareRounds);
  if (!rounds.length) return [];
  const r = await getRound(rounds[0].id);
  return [...new Set((r?.players ?? []).map((p) => p.name))].sort((a, b) => a.localeCompare(b, 'de'));
}
