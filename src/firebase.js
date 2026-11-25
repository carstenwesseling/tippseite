import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'firebase/auth';

const env = import.meta.env;
export const configured = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID);

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
const app = configured ? initializeApp(config) : null;

export const db = app ? getFirestore(app) : null;
export const auth = app ? getAuth(app) : null;

// Nur ein Anmelde-Popup gleichzeitig: Doppelklicks lösen sonst auth/cancelled-popup-request aus.
let pending = null;
const QUIET = ['auth/cancelled-popup-request', 'auth/popup-closed-by-user'];
export function login() {
  if (pending) return pending;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  pending = signInWithPopup(auth, provider)
    .catch((e) => {
  if (QUIET.includes(e.code)) return; // Popup abgebrochen oder durch zweiten Klick ersetzt: kein Fehler für den Nutzer
  if (e.code === 'auth/popup-blocked') throw new Error('Das Anmelde-Fenster wurde vom Browser blockiert. Bitte Pop-ups für diese Seite erlauben und erneut versuchen.');
  throw e;
    })
    .finally(() => { pending = null; });
  return pending;
}
export const logout = () => signOut(auth);
export const onUser = (cb) => (auth ? onAuthStateChanged(auth, cb) : (cb(null), () => {}));

// Zusätzlicher Admin: Anmeldung per Name + 4-stelliger PIN. Technisch ein E-Mail/Passwort-Konto, dessen Daten aus Name und PIN
// abgeleitet werden (in der Firebase-Konsole muss "E-Mail/Passwort" als Anmeldemethode aktiviert sein).
const hex = (s) => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const delegateCreds = (name, pin) => {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return { email: `${hex(n)}-${pin}@benutzer.tippspiel.app`, password: `tipp-${pin}-${hex(n).slice(0, 12)}` };
};
export const loginDelegate = async (name, pin) => {
  const { email, password } = delegateCreds(name, pin);
  try { await signInWithEmailAndPassword(auth, email, password); }
  catch (e) {
    if (/invalid|user-not-found|wrong-password|credential/.test(e.code)) throw new Error('Name oder PIN stimmt nicht.');
    throw e;
  }
};
/** Legt das Konto über eine zweite App-Instanz an, damit der Besitzer angemeldet bleibt. Gibt die E-Mail zurück. */
export async function createDelegateAccount(name, pin) {
  const { email, password } = delegateCreds(name, pin);
  const second = initializeApp(config, `second-${Date.now()}`);
  const a = getAuth(second);
  try { await createUserWithEmailAndPassword(a, email, password); }
  catch (e) { if (e.code !== 'auth/email-already-in-use') throw e; }
  await signOut(a);
  return email;
}
