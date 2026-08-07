'use client';

import { AppShell } from '@/components/AppShell';
import { useAuth } from '@/components/AuthProvider';

/** Stub. No screen was designed for this tab; it exists so the bar is honest. */
export default function MePage() {
  const { user, profileName, signOutNow } = useAuth();

  return (
    <AppShell title="Your account">
      <div className="surface" style={{ padding: 'var(--space-6)' }}>
        <h2>{profileName ?? 'Your account'}</h2>
        <p className="muted">{user?.phoneNumber}</p>
        <button className="btn btn-secondary" onClick={() => void signOutNow()}>
          Sign out
        </button>
      </div>
    </AppShell>
  );
}
