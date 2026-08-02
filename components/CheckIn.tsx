'use client';

import { useEffect, useRef, useState } from 'react';

import { checkInAction } from '@/app/actions/booking';
import type { CheckInResult } from '@/lib/types';
import { useAuth } from './AuthProvider';

/**
 * QR check-in (DESIGN.md §6.5).
 *
 * The customer scans the salon's QR code with their own phone camera and lands
 * here. There is no camera code in this app and no scanner hardware — the QR is
 * just a link to /checkin. Once signed in, check-in fires automatically and the
 * owner's dashboard updates live via onSnapshot.
 */
export function CheckIn() {
  const { getIdToken, profileName } = useAuth();
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [result, setResult] = useState<(CheckInResult & { alreadyCheckedIn: boolean }) | null>(
    null
  );
  const [message, setMessage] = useState<string | null>(null);
  // Guards against React 18 StrictMode double-invoking the effect in dev.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      const response = await checkInAction({ idToken: await getIdToken() });
      if (!response.ok) {
        setState('error');
        setMessage(response.message);
        return;
      }
      setResult(response.data);
      setState('done');
    })();
  }, [getIdToken]);

  if (state === 'working') {
    return (
      <div className="card">
        <h2>Checking you in…</h2>
        <p className="muted">One moment.</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="card">
        <h2>We couldn’t check you in</h2>
        <p className="error">{message}</p>
        <p className="muted">
          Please let the front desk know — they can look you up by phone number.
        </p>
      </div>
    );
  }

  return (
    <div className="card success">
      <h2>{result?.alreadyCheckedIn ? 'Already checked in' : 'Checked in'}</h2>
      <p className="big">
        {profileName ? `Thanks, ${profileName}!` : 'Thanks!'} Have a seat.
      </p>
      <p>
        {result?.serviceName} with {result?.stylistName}
      </p>
      <p className="muted">{result?.label}</p>
    </div>
  );
}
