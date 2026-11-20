import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch, orderBy, query,
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
