/**
 * Server Actions must RETURN failures, not throw them.
 *
 * Next.js redacts thrown error messages in production builds (they become
 * "An error occurred in the Server Components render"), so a thrown
 * "That slot was just taken" would reach the customer as gibberish. Every
 * action in app/actions returns an ActionResult instead.
 */

export type ErrorCode =
  | 'unauthenticated'
  | 'invalid-argument'
  | 'not-found'
  | 'already-exists'
  | 'failed-precondition'
  | 'permission-denied'
  | 'unavailable'
  | 'internal';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(code: ErrorCode, message: string): ActionResult<T> {
  return { ok: false, code, message };
}

/** Thrown inside server-side helpers, converted to a failed ActionResult at the action boundary. */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

/**
 * Wraps an action body so any AppError becomes a typed failure and anything
 * unexpected becomes a generic 'internal' — with the real cause logged
 * server-side rather than leaked to the client.
 */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (error) {
    if (error instanceof AppError) {
      return fail(error.code, error.message);
    }
    console.error('[action] unhandled error', error);
    return fail('internal', 'Something went wrong. Please try again.');
  }
}
