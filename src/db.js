import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, writeBatch, orderBy, query, where,
} from 'firebase/firestore';
import { db } from './firebase.js';
import { fetchSeason } from './openliga.js';

const STALE_MS = 15 * 60 * 1000;

// ---- Admin ----
export async function checkAdmin(user) {
  if (!user?.email) return false;
  try {
    return (await getDoc(doc(db, 'admins', user.email.toLowerCase()))).exists();
  } catch {
    return false;
  }
}

// ---- Halbserien ----
export async function listRounds() {
  const snap = await getDocs(query(collection(db, 'rounds'), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getRound(id) {
  const r = await getDoc(doc(db, 'rounds', id));
  if (!r.exists()) return null;
  const ps = await getDocs(collection(db, 'rounds', id, 'players'));
  return { id, ...r.data(), players: ps.docs.map((d) => d.data()) };
}

/** Speichert eine Halbserie samt Spielern (Batches à max. 400 Schreibvorgänge). */
export async function saveRound({ title, jahr, typ, order, excelResults, players }) {
  const ref = doc(collection(db, 'rounds'));
  await setDoc(ref, {
    title, jahr, typ, order, excelResults: excelResults ?? [],
    playerCount: players.length, createdAt: Date.now(),
  });
  for (let i = 0; i < players.length; i += 400) {
    const batch = writeBatch(db);
    for (const p of players.slice(i, i + 400)) {
      batch.set(doc(db, 'rounds', ref.id, 'players', encodeURIComponent(p.name)), { name: p.name, tips: p.tips });
    }
    await batch.commit();
  }
  return ref.id;
}

export async function deleteRound(id) {
  const ps = await getDocs(collection(db, 'rounds', id, 'players'));
  for (let i = 0; i < ps.docs.length; i += 400) {
    const batch = writeBatch(db);
    ps.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await deleteDoc(doc(db, 'rounds', id));
}

// ---- Ergebnisse (Cache in Firestore, Quelle OpenLigaDB) ----
/**
 * Liefert die Spiele einer Saison. Frischer Cache -> Cache; sonst API.
 * Schreiben in den Cache nur, wenn `canWrite` (Admin) – Besucher nutzen die API-Daten nur im Speicher.
 */
export async function getSeasonMatches(jahr, { canWrite = false, force = false } = {}) {
  const ref = doc(db, 'results', String(jahr));
  let cached = null;
  try {
    const s = await getDoc(ref);
    if (s.exists()) cached = s.data();
  } catch { /* Cache optional */ }
  if (cached && !force && Date.now() - cached.updatedAt < STALE_MS) return { ...cached, source: 'cache' };
  try {
    const matches = await fetchSeason(jahr);
    const fresh = { matches, updatedAt: Date.now() };
    if (canWrite) await setDoc(ref, fresh);
    return { ...fresh, source: 'live' };
  } catch (e) {
    if (cached) return { ...cached, source: 'cache (API nicht erreichbar)', error: e.message };
    throw e;
  }
}

// ---- Mitglieder ----
// members/{id}: { name, aktiv, sendExcel } öffentlich lesbar; memberMail/{id}: { email } nur für Admins.
export const memberId = (name) => encodeURIComponent(name.trim());

export async function listMembers({ onlyActive = false } = {}) {
  const ref = collection(db, 'members');
  const snap = await getDocs(onlyActive ? query(ref, where('aktiv', '==', true)) : ref);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Nur Admins: hinterlegte Mailadressen (id -> Adresse). */
export async function listMemberMails() {
  const snap = await getDocs(collection(db, 'memberMail'));
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data().email]));
}

/** rows: { name, aktiv, sendExcel, email }; removed: Mitglieds-IDs, die gelöscht werden. */
export async function saveMembers(rows, removed = []) {
  const ops = [];
  for (const r of rows) {
    const id = memberId(r.name);
    ops.push((b) => b.set(doc(db, 'members', id), { name: r.name.trim(), aktiv: !!r.aktiv, sendExcel: !!r.sendExcel }));
    if (r.sendExcel && r.email) ops.push((b) => b.set(doc(db, 'memberMail', id), { email: r.email.trim() }));
    else ops.push((b) => b.delete(doc(db, 'memberMail', id)));
  }
  for (const id of removed) {
    ops.push((b) => b.delete(doc(db, 'members', id)));
    ops.push((b) => b.delete(doc(db, 'memberMail', id)));
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
  await setDoc(TIPPING(), { title, jahr, typ, first, order, open: true, createdAt: Date.now() });
}

export const setTippingOpen = (open) => setDoc(TIPPING(), { open }, { merge: true });

export async function getTips(id) {
  const s = await getDoc(doc(db, 'tipping', 'current', 'tips', id));
  return s.exists() ? s.data() : null;
}

/** Speichert den Tipp; erneutes Abschicken überschreibt ihn, solange die Runde offen ist. */
export const saveTips = (id, name, tips) =>
  setDoc(doc(db, 'tipping', 'current', 'tips', id), { name, tips, updatedAt: Date.now() });

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
  const tips = await listTips();
  const players = tips.map((p) => ({
    name: p.name,
    tips: Object.fromEntries(Object.entries(p.tips ?? {}).filter(([, v]) => Number.isFinite(v?.h) && Number.isFinite(v?.g))),
  }));
  const id = await saveRound({
    title: t.title, jahr: t.jahr, typ: t.typ, excelResults: [], players,
    order: t.order.map((o) => ({ block: o.spieltag - t.first + 1, home: o.home, away: o.away, key: o.key })),
  });
  await deleteTipping();
  return id;
}

/** Excel-Tippschein per Mail: Dokument für die Firebase-Erweiterung "Trigger Email from Firestore" (Sammlung `mail`). */
export const queueExcelMail = ({ memberId: id, to, subject, text, filename, base64 }) =>
  addDoc(collection(db, 'mail'), {
    memberId: id, to: [to],
    message: { subject, text, attachments: [{ filename, content: base64, encoding: 'base64' }] },
  });
