'use client';

import { useState } from 'react';
import Link from 'next/link';

import { AppShell } from '@/components/AppShell';
import { BookFlow } from '@/components/BookFlow';
import { QuickBook } from '@/components/QuickBook';

type Tab = 'book' | 'quick';

export default function CustomerPage() {
  const [tab, setTab] = useState<Tab>('book');

  return (
    <AppShell title="Book a visit">
      <nav className="tabs">
        <button
          className={tab === 'book' ? 'tab active' : 'tab'}
          onClick={() => setTab('book')}
        >
          Book
        </button>
        <button
          className={tab === 'quick' ? 'tab active' : 'tab'}
          onClick={() => setTab('quick')}
        >
          Quick book
        </button>
      </nav>

      {tab === 'book' ? <BookFlow /> : <QuickBook />}

      <p className="footnote">
        Arriving now? <Link href="/checkin">Check in</Link> · Owner?{' '}
        <Link href="/owner">Today’s schedule</Link>
      </p>
    </AppShell>
  );
}
