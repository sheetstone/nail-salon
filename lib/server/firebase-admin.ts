import 'server-only';

import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

import { FIRESTORE_DATABASE_ID } from '../config';

/**
 * Admin SDK singleton. Server Actions run on Cloud Run under App Hosting, which
 * supplies Application Default Credentials, so initializeApp() needs no
 * arguments in production.
 *
 * Locally, two paths work:
 *   - Emulators: FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST are
 *     honoured automatically by the SDK. A projectId is still required.
 *   - Real project: set GOOGLE_APPLICATION_CREDENTIALS to a service-account key.
 *
 * The `server-only` import makes it a build error for a Client Component to
 * pull this in — the failure surfaces at compile time, not as a leaked key.
 */

function projectId(): string {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    'nail-salon-poc-2026'
  );
}

function adminApp(): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0];
  return initializeApp({ projectId: projectId() });
}

export const adminDb = getFirestore(adminApp(), FIRESTORE_DATABASE_ID);
export const adminAuth = getAuth(adminApp());

export const COL = {
  customers: 'customers',
  stylists: 'stylists',
  services: 'services',
  appointments: 'appointments',
  slotLocks: 'slotLocks',
} as const;

/** Appointment statuses that still occupy the stylist's time. */
export const ACTIVE_STATUSES = ['booked', 'checked-in', 'completed'] as const;
