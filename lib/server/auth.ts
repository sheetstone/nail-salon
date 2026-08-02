import 'server-only';

import { adminAuth } from './firebase-admin';
import { AppError } from '../result';

/**
 * Server Actions do not inherit a Firebase session. The client passes the
 * Firebase ID token it already holds, and we verify it here with the Admin SDK.
 *
 * NEVER trust a uid or phone number sent from the client — only the values
 * decoded out of a verified token. That is the whole point of this module.
 */

export interface CallerIdentity {
  uid: string;
  /** E.164, from the verified token — not from the request body. */
  phone: string;
}

export async function requireCaller(idToken: unknown): Promise<CallerIdentity> {
  if (typeof idToken !== 'string' || idToken.length === 0) {
    throw new AppError('unauthenticated', 'Please sign in first.');
  }

  let decoded;
  try {
    // checkRevoked=true costs an extra lookup but means a signed-out or
    // disabled account cannot keep booking with a cached token.
    decoded = await adminAuth.verifyIdToken(idToken, true);
  } catch {
    throw new AppError('unauthenticated', 'Your session expired. Please sign in again.');
  }

  const phone = decoded.phone_number;
  if (typeof phone !== 'string' || !phone.startsWith('+')) {
    throw new AppError(
      'failed-precondition',
      'This account has no verified phone number.'
    );
  }

  return { uid: decoded.uid, phone };
}
