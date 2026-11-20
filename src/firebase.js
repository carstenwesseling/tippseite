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

export const login = () => signInWithPopup(auth, new GoogleAuthProvider());
export const logout = () => signOut(auth);
export const onUser = (cb) => (auth ? onAuthStateChanged(auth, cb) : (cb(null), () => {}));
