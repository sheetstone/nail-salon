'use client';

import { AppShell } from '@/components/AppShell';

/**
 * Stub. The real screen is issue #12 (Visits: upcoming, waitlist, past) and
 * depends on the reschedule / waitlist / policy-window backend issues.
 */
export default function VisitsPage() {
  return (
    <AppShell title="Your visits">
      <div className="surface" style={{ padding: 'var(--space-6)' }}>
        <h2>Your visits</h2>
        <p className="muted">
          Upcoming appointments, the waitlist, and past visits land here. Tracked in issue #12.
        </p>
      </div>
    </AppShell>
  );
}
