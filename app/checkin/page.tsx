'use client';

import { AppShell } from '@/components/AppShell';
import { CheckIn } from '@/components/CheckIn';

/**
 * The QR code on the counter points here. A customer who is already signed in
 * gets checked in immediately; a new one signs in first and then lands back
 * on the same screen.
 */
export default function CheckInPage() {
  return (
    <AppShell title="Check in">
      <CheckIn />
    </AppShell>
  );
}
