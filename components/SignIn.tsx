'use client';

import { useEffect, useRef, useState } from 'react';
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth';

import { firebaseAuth } from '@/lib/firebase-client';
import { upsertCustomerAction } from '@/app/actions/booking';
import { useAuth } from './AuthProvider';

/**
 * Phone + SMS sign-in (DESIGN.md §6.1).
 *
 * Web phone auth REQUIRES a reCAPTCHA verifier. We use the invisible one, which
 * still needs a real DOM container to attach to — hence the ref below. Test on
 * a real device, not just the emulator: the emulator skips reCAPTCHA entirely,
 * so a broken verifier only shows up in production.
 */
export function SignIn() {
  const recaptchaRef = useRef<HTMLDivElement>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      verifierRef.current?.clear();
      verifierRef.current = null;
    };
  }, []);

  /** Digits in, E.164 out. Phone numbers are stored E.164 everywhere. */
  function toE164(raw: string): string | null {
    const digits = raw.replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) return digits.length >= 8 ? digits : null;
    // POC assumes a US salon; a real build would ask for the country.
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return null;
  }

  async function sendCode() {
    setError(null);
    const e164 = toE164(phone);
    if (!e164) {
      setError('Enter a 10-digit US number, or a full +country number.');
      return;
    }

    setBusy(true);
    try {
      const auth = firebaseAuth();
      if (!verifierRef.current && recaptchaRef.current) {
        verifierRef.current = new RecaptchaVerifier(auth, recaptchaRef.current, {
          size: 'invisible',
        });
      }
      if (!verifierRef.current) throw new Error('reCAPTCHA failed to initialise.');

      const result = await signInWithPhoneNumber(auth, e164, verifierRef.current);
      setConfirmation(result);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : 'Could not send the code. Try again.'
      );
      // A failed attempt burns the verifier; rebuild it on the next try.
      verifierRef.current?.clear();
      verifierRef.current = null;
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!confirmation) return;
    setError(null);
    setBusy(true);
    try {
      await confirmation.confirm(code.trim());
      // AuthProvider's onAuthStateChanged takes over from here.
    } catch {
      setError('That code did not match. Check it and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Sign in</h2>
      <p className="muted">
        We text you a 6-digit code. No password, no app to install.
      </p>

      {!confirmation ? (
        <>
          <label htmlFor="phone">Mobile number</label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(555) 123-4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
          />
          <button className="primary" onClick={sendCode} disabled={busy}>
            {busy ? 'Sending…' : 'Text me a code'}
          </button>
        </>
      ) : (
        <>
          <label htmlFor="code">6-digit code</label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={busy}
          />
          <button className="primary" onClick={verifyCode} disabled={busy}>
            {busy ? 'Checking…' : 'Verify'}
          </button>
          <button
            className="ghost"
            onClick={() => {
              setConfirmation(null);
              setCode('');
            }}
            disabled={busy}
          >
            Use a different number
          </button>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {/* The invisible reCAPTCHA still needs a mount point. */}
      <div ref={recaptchaRef} />
    </div>
  );
}

/** Shown once, right after a first sign-in, to fill in customers/{uid}.name. */
export function NameGate() {
  const { getIdToken, refreshProfile } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const result = await upsertCustomerAction({
      idToken: await getIdToken(),
      name,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    await refreshProfile();
  }

  return (
    <div className="card">
      <h2>What should we call you?</h2>
      <label htmlFor="name">First name</label>
      <input
        id="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Alex"
        disabled={busy}
      />
      <button className="primary" onClick={save} disabled={busy || !name.trim()}>
        {busy ? 'Saving…' : 'Continue'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
