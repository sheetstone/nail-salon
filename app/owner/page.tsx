'use client';

import { AppShell } from '@/components/AppShell';
import { OwnerDashboard } from '@/components/OwnerDashboard';

/**
 * The owner's tablet view.
 *
 * POC: any signed-in user can open this, because firestore.rules allows any
 * authenticated read of `appointments` (DESIGN.md §7). Before real use, gate it
 * on a custom claim (e.g. `owner: true`) and tighten the rule to match.
 */
export default function OwnerPage() {
  return (
    <AppShell title="Today’s schedule">
      <OwnerDashboard />
    </AppShell>
  );
}
