'use client';

import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

import { FIRESTORE_DATABASE_ID } from './config';

/**
 * Firebase web config is client-side by design — the apiKey here is an
 * identifier, not a secret. Access control lives in firestore.rules and in the
 * ID-token check inside every Server Action.
 *
 * These come from the NEXT_PUBLIC_* values in apphosting.yaml, which Next.js
 * inlines at BUILD time.
 *
 * Note on FIREBASE_WEBAPP_CONFIG: App Hosting does inject it when the backend
 * is linked to a Web App, but WITHOUT a NEXT_PUBLIC_ prefix — so it is
 * server-only and can never reach this module. An earlier version of this file
 * read `process.env.NEXT_PUBLIC_FIREBASE_WEBAPP_CONFIG` as a "fallback", which
 * was dead code that read like a safety net. The NEXT_PUBLIC_* values are the
 * only source; if they are missing the app fails loudly at init rather than
 * silently half-configuring.
 */
function firebaseOptions(): FirebaseOptions {
  const options: FirebaseOptions = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  if (!options.apiKey || !options.projectId) {
    throw new Error(
      'Firebase web config is missing. Set the NEXT_PUBLIC_FIREBASE_* values ' +
        'in .env.local (dev) or apphosting.yaml with availability [BUILD, RUNTIME].'
    );
  }
  return options;
}

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';

function createApp() {
  if (getApps().length > 0) return getApp();
  const app = initializeApp(firebaseOptions());
  return app;
}

let emulatorsWired = false;

export function firebaseAuth() {
  const auth = getAuth(createApp());
  if (useEmulators && !emulatorsWired) {
    wireEmulators();
  }
  return auth;
}

export function firebaseDb() {
  const db = getFirestore(createApp(), FIRESTORE_DATABASE_ID);
  if (useEmulators && !emulatorsWired) {
    wireEmulators();
  }
  return db;
}

function wireEmulators() {
  if (emulatorsWired) return;
  emulatorsWired = true;
  try {
    connectAuthEmulator(getAuth(createApp()), 'http://127.0.0.1:9099', {
      disableWarnings: true,
    });
    connectFirestoreEmulator(getFirestore(createApp(), FIRESTORE_DATABASE_ID), '127.0.0.1', 8080);
  } catch (error) {
    // Reconnecting an already-connected emulator throws; harmless in dev.
    console.debug('Emulator wiring skipped:', error);
  }
}
