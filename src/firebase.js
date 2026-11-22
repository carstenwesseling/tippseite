import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

const env = import.meta.env;
export const configured = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID);

const app = configured
  ? initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    })
  : null;

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
