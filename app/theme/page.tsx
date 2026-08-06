import {
  ArrowCounterClockwise,
  CaretRight,
  Sparkle,
  ArrowRight,
} from '@phosphor-icons/react/dist/ssr';

import { THEME_PRESETS, themeToStyleAttr, type SalonTheme } from '@/lib/theme';

export const metadata = {
  title: 'Theme preview — one token, every salon',
};

/**
 * The proof that the theming principle holds (DESIGN-SYSTEM.md).
 *
 * Every panel below renders the SAME components. The only difference between
 * them is the six CSS custom properties set on the wrapper. If a component ever
 * hard-codes a colour, it will stay purple in the other four panels — which is
 * exactly what makes this page useful.
 */

/** A slice of the 2a Home screen: AI entry + proposal card. */
function QuickBookCard() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div
        className="surface"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: '10px var(--space-4)',
        }}
      >
        <Sparkle size={17} color="var(--brand)" />
        <span style={{ flex: 1, fontSize: 14 }}>gel mani friday pm with anyone</span>
        <ArrowRight size={16} color="var(--brand)" />
      </div>

      <div
        style={{
          padding: '12px 14px',
          borderRadius: 'var(--card-radius)',
          background: 'var(--brand-wash)',
        }}
      >
        <div style={{ fontSize: 14, lineHeight: 1.45 }}>
          Amy has{' '}
          <span style={{ color: 'var(--brand-text)', fontWeight: 500 }}>Friday 2:00 PM</span>{' '}
          open for a gel manicure. Bao has 4:00 PM.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn btn-primary">Book 2:00 PM</button>
          <button className="btn btn-secondary">See the day</button>
        </div>
      </div>
    </div>
  );
}

/** "Book last visit again" — the repeat-booking row. */
function RepeatRow() {
  return (
    <div
      className="surface"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
      }}
    >
      <ArrowCounterClockwise size={20} color="var(--brand)" />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>Book last visit again</div>
        <div style={{ fontSize: 12, color: 'var(--ink-55)' }}>
          Gel manicure + removal with Amy · $70
        </div>
      </div>
      <CaretRight size={16} color="var(--ink-40)" />
    </div>
  );
}

/** "Who's in today" — stylist cards with open-count chips. */
function StylistList() {
  const stylists = [
    { name: 'Amy', detail: 'Gel & acrylic · 9 AM–5 PM', open: '4 open' },
    { name: 'Bao', detail: 'Pedicures & nail art · 11 AM–7 PM', open: '6 open' },
    { name: 'Chi', detail: 'Gel specialist · 10 AM–2 PM', open: 'Full' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Who&rsquo;s in today</h3>
        <span style={{ fontSize: 13, color: 'var(--brand-text)' }}>All stylists</span>
      </div>

      {stylists.map((s) => (
        <div
          key={s.name}
          className="surface"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-4)',
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              background: 'var(--brand-tint)',
              display: 'grid',
              placeItems: 'center',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--brand-text)',
            }}
          >
            {s.name[0]}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>{s.name}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-55)' }}>{s.detail}</div>
          </div>
          <span className={s.open === 'Full' ? 'chip chip-quiet' : 'chip'}>{s.open}</span>
        </div>
      ))}
    </div>
  );
}

/** A timeline column — open / booked / picked, the three block states. */
function TimelineColumn() {
  const blocks: Array<{ label: string; kind: 'open' | 'taken' | 'picked'; grow: number }> = [
    { label: '9:00', kind: 'open', grow: 1 },
    { label: 'booked', kind: 'taken', grow: 2 },
    { label: '11:15', kind: 'open', grow: 1 },
    { label: '1:00 · picked', kind: 'picked', grow: 1.5 },
    { label: 'booked', kind: 'taken', grow: 1 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <h3 style={{ margin: 0, fontSize: 15 }}>Thu, Aug 6 · Amy</h3>
      <div
        className="surface"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          padding: 'var(--space-2)',
          height: 190,
        }}
      >
        {blocks.map((b, i) => (
          <div
            key={i}
            className={
              b.kind === 'open' ? 'slot' : b.kind === 'taken' ? 'slot slot-taken' : 'slot slot-picked'
            }
            style={{
              flex: b.grow,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
            }}
          >
            {b.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ThemePanel({ theme }: { theme: SalonTheme }) {
  return (
    <section
      style={{
        // The ONLY per-theme difference on this page.
        ...Object.fromEntries(
          themeToStyleAttr(theme)
            .split('; ')
            .map((pair) => pair.split(': '))
        ),
        background: 'var(--page)',
        borderRadius: 14,
        padding: 'var(--space-6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)',
        minWidth: 320,
      } as React.CSSProperties}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="kicker">{theme.name}</div>
        <div
          style={{
            display: 'flex',
            gap: 6,
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 11,
            color: 'var(--ink-45)',
          }}
        >
          <span>{theme.brand}</span>
          <span>·</span>
          <span>r{theme.radius}</span>
        </div>
      </header>

      <QuickBookCard />
      <RepeatRow />
      <StylistList />
      <TimelineColumn />
    </section>
  );
}

export default function ThemePreviewPage() {
  return (
    // The two literal colours below are the ONLY ones in the app, and they are
    // deliberate: this page's chrome sits outside every theme panel and stays
    // theme-neutral so the frame doesn't bias the comparison. Product
    // components must never do this — see DESIGN-SYSTEM.md.
    <main style={{ padding: '40px 24px 80px', background: '#e9eaf0', minHeight: '100dvh' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>One token, every salon</h1>
        <p style={{ maxWidth: 620, color: '#5a5c68', marginBottom: 32 }}>
          Every panel renders the <strong>same</strong> components from direction 2a. The only
          difference is the six CSS custom properties on each wrapper — no per-theme component,
          no per-theme stylesheet. If anything below stays purple, something hard-coded a colour.
          See <code>DESIGN-SYSTEM.md</code>.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 20,
            alignItems: 'start',
          }}
        >
          {THEME_PRESETS.map((theme) => (
            <ThemePanel key={theme.name} theme={theme} />
          ))}
        </div>
      </div>
    </main>
  );
}
