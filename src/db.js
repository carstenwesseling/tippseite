import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase.js';
import { fetchSeason } from './openliga.js';
import { roundCode, compareRounds, normName } from './halbserie.js';

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
  const snap = await getDocs(collection(db, 'rounds'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(compareRounds);
}

export async function getRound(id) {
  const r = await getDoc(doc(db, 'rounds', id));
  if (!r.exists()) return null;
  const ps = await getDocs(collection(db, 'rounds', id, 'players'));
  return { id, ...r.data(), players: ps.docs.map((d) => d.data()) };
}

/** Speichert eine Halbserie samt Spielern (Batches à max. 400 Schreibvorgänge). */
export async function saveRound({ jahr, typ, order, excelResults, players, kind, liga, spieltage, totalsOnly }) {
  const ref = doc(collection(db, 'rounds'));
  await setDoc(ref, {
    title: roundCode({ jahr, typ }), jahr, typ, order: order ?? [], excelResults: excelResults ?? [],
    playerCount: players.length, createdAt: Date.now(),
    ...(kind ? { kind } : {}), ...(liga ? { liga } : {}), ...(spieltage ? { spieltage } : {}), ...(totalsOnly ? { totalsOnly: true } : {}),
  });
  await writePlayers(ref.id, players);
  return ref.id;
}

async function writePlayers(roundId, players) {
  for (let i = 0; i < players.length; i += 400) {
    const batch = writeBatch(db);
    for (const p of players.slice(i, i + 400)) {
      batch.set(doc(db, 'rounds', roundId, 'players', encodeURIComponent(p.name)), { name: p.name, tips: p.tips ?? {}, ...(p.perDay ? { perDay: p.perDay } : {}), ...(typeof p.total === 'number' ? { total: p.total } : {}) });
    }
    await batch.commit();
  }
}

/**
 * Fügt Mitspieler (z. B. einzeln hochgeladene Blätter) einer bestehenden Halbserie hinzu.
 * Gleichnamige Mitspieler werden überschrieben. Spielplan/Fallback-Ergebnisse werden nur ergänzt, wenn leer.
 */
export async function addPlayersToRound(roundId, { players, order, excelResults }) {
  const ref = doc(db, 'rounds', roundId);
  const round = await getDoc(ref);
  if (!round.exists()) throw new Error('Halbserie nicht gefunden.');
  await writePlayers(roundId, players);
  const count = (await getDocs(collection(db, 'rounds', roundId, 'players'))).size;
  const patch = { playerCount: count };
  const r = round.data();
  if (!r.order?.length && order?.length) patch.order = order;
  if (!r.excelResults?.length && excelResults?.length) patch.excelResults = excelResults;
  await updateDoc(ref, patch);
  return count;
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

// ---- Mitglieder (nur Admins) ----
// members/{id}: { name, aliases: [Schreibweisen in Excel-Dateien], createdAt }
export const memberId = (name) => encodeURIComponent(normName(name));
export const memberNames = (m) => [m.name, ...(m.aliases ?? [])].map(normName);

export async function listMembers() {
  const snap = await getDocs(collection(db, 'members'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
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
