'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  CalendarPlus,
  ClockCounterClockwise,
  User,
  UserCircle,
} from '@phosphor-icons/react';

import { useAuth } from './AuthProvider';
import { NameGate, SignIn } from './SignIn';

/**
 * The frame every customer screen sits in (design 2a).
 *
 * Mobile: brand header + a fixed bottom tab bar (Book / Visits / Me).
 * Tablet: the tabs move up into a top nav, and the bottom bar disappears.
 *
 * The breakpoint is pure CSS (`.shell-*` in globals.css) rather than a JS
 * media query — a JS breakpoint would render the wrong bar on the server and
 * flip after hydration.
 */

interface Tab {
  href: string;
  label: string;
  Icon: typeof CalendarPlus;
}

const TABS: Tab[] = [
  { href: '/', label: 'Book', Icon: CalendarPlus },
  { href: '/visits', label: 'Visits', Icon: ClockCounterClockwise },
  { href: '/me', label: 'Me', Icon: UserCircle },
];

/** Tablet nav has an extra destination the phone bar doesn't. */
const TABLET_LINKS = [...TABS, { href: '/owner', label: 'Stylists', Icon: User }];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function AppShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { user, loading, profileName, signOutNow } = useAuth();
  const pathname = usePathname() ?? '/';

  const gated = loading || !user || !profileName;

  return (
    <div className="shell">
      <header className="shell-top">
        <Link href="/" className="shell-brand">
          Polish Bar
        </Link>

        {/* Tablet-only inline nav. Hidden on phones, where the bottom bar owns
            navigation. */}
        {!gated && (
          <nav className="shell-topnav">
            {TABLET_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={isActive(pathname, href) ? 'shell-topnav-link is-active' : 'shell-topnav-link'}
              >
                {label}
              </Link>
            ))}
          </nav>
        )}

        {user && (
          <>
            <button className="btn btn-icon" aria-label="Notifications">
              <Bell size={18} />
            </button>
            <button
              className="btn btn-icon"
              aria-label="Sign out"
              onClick={() => void signOutNow()}
            >
              <User size={18} />
            </button>
          </>
        )}
      </header>

      <main className="shell-main">
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
      </main>

      {/* Phone-only. Suppressed while signed out so the sign-in screen isn't
          framed by navigation that goes nowhere. */}
      {!gated && (
        <nav className="shell-tabs" aria-label="Main">
          {TABS.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={active ? 'shell-tab is-active' : 'shell-tab'}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={20} weight={active ? 'fill' : 'regular'} />
                {label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
