'use client';

import type { ReactNode } from 'react';

import { useAuth } from './AuthProvider';
import { NameGate, SignIn } from './SignIn';

/**
 * Gate every customer-facing screen behind: signed in -> has a profile name.
 * Both steps are cheap and idempotent, so any page can wrap itself in this.
 */
export function AppShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { user, loading, profileName, signOutNow } = useAuth();

  return (
    <main>
      <header className="topbar">
        <span className="brand">Polish Bar</span>
        {user && (
          <button className="link" onClick={() => void signOutNow()}>
            Sign out
          </button>
        )}
      </header>

      <div className="content">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : !user ? (
          <SignIn />
        ) : !profileName ? (
          <NameGate />
        ) : (
          <>
            <h1 className="sr-only">{title}</h1>
            {children}
          </>
        )}
      </div>
    </main>
  );
}
