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
 * App Hosting injects FIREBASE_WEBAPP_CONFIG when the backend is linked to a
 * Firebase Web App, so that is tried first and the NEXT_PUBLIC_* vars are the
 * fallback for local dev.
 */
function firebaseOptions(): FirebaseOptions {
  const injected = process.env.NEXT_PUBLIC_FIREBASE_WEBAPP_CONFIG;
  if (injected) {
    try {
      return JSON.parse(injected) as FirebaseOptions;
    } catch {
      console.warn('FIREBASE_WEBAPP_CONFIG was not valid JSON; falling back to env vars.');
    }
  }
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
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
