# Design system & theming

How this app looks, and the one principle that governs it. Read this before
writing any component. The visual spec is `Booking Redesign.dc.html` in the
[Booking system redesign](https://claude.ai/design/p/0e234cf1-5453-41ec-b4af-7245846e97e1)
Claude Design project; this file is how that spec becomes code.

## Which direction we build

**2a — "Day timeline, daylight."** The design project holds three directions:

| | | |
|---|---|---|
| **1a** | Turn 1 | Step-by-step: home → pick a time → confirm |
| **1b** | Turn 1 | Timeline, dark ground |
| **2a** | Turn 2 | Timeline, light ground ← **this is what we build** |

2a is not a separate palette from 1b. It is the same structure re-grounded:
warm-neutral light instead of dark, with the accent moved to `#7a5af0`.

## What 2a actually is

It sits on **Nocturne**, the design system in `_ds/nocturne-…/`. That matters
because 2a inherits Nocturne's rules rather than replacing them:

- **Spacing** — Nocturne's 0.70× density scale, unchanged. Every gap and pad in
  the 2a screens is one of `2.8 / 5.6 / 8.4 / 11.2 / 16.8 / 22.4px`. Those are
  `--space-1` … `--space-8`. If you are typing a raw pixel gap, you are off the
  scale.
- **Type** — Inter, headings at weight 500. *Hierarchy is size and space, never
  weight.* Do not bolden past 500.
- **Radii** — 8px default (`--card-radius`), 4px small, 14px large.
- **Icons** — [Phosphor](https://phosphoricons.com), regular weight, throughout.
- **States are themed, never browser defaults** — every interactive element gets
  a hover tint and a `:focus-visible { outline: 2px solid var(--brand) }` ring.
- **The accent is a line and a mark, not a flood.** Nocturne forbids large
  saturated fills. 2a's "primary" button is a 12% brand tint with brand-coloured
  text, not a solid block. The only full-brand fills are small: the picked slot
  and the selected date.

What 2a changes from Nocturne: the ground goes light, and the accent goes to the
salon's own colour.

---

## The principle: a salon's identity is six values

> **Every salon gets its own look by changing six tokens and nothing else.**
> No per-salon component, no per-salon stylesheet, no per-salon branch in code.

```
--brand         the one accent
--page          app background
--card          surface, one step up from page
--ink           primary text
--line          hairlines and dividers
--card-radius   corner radius
```

They live in `lib/theme.ts` as a `SalonTheme`, and reach the DOM as CSS custom
properties. Everything else in `app/globals.css` is **derived** from them.

### Why this is the design's own thesis, not something bolted on

The spec's own note on 2a:

> *Every accent — chips, open slots, buttons, the picked block — reads from one
> `--brand` token, so swapping to a salon's own colour is a one-line change.*

The design file exposes `brand` as a **colour editor with preset options**, so
the direction was authored to be re-themed. Our job is to not lose that in the
translation to React.

### The rules that keep it true

**1. No component may write a literal colour.** Not a hex, not an `rgb()`, not a
named colour. If a component needs a shade, it uses a token.

**2. Need a shade that doesn't exist? Add a derived token — never inline it.**
Derived tokens live in `globals.css` and are computed with `color-mix()` from
the six roots:

```css
--brand-wash: color-mix(in srgb, var(--brand) 9%, transparent);
--ink-55:     color-mix(in srgb, var(--ink) 55%, transparent);
```

This is why a theme author supplies six values instead of a 40-step palette —
the ramp is computed, so it cannot be supplied inconsistently.

**3. Derive greys from `--ink`, not from a grey scale.** Every muted text colour
in 2a is `--ink` at reduced alpha. A salon with warm brown ink gets warm grey
secondary text for free; a hard-coded `#6d6169` would fight it.

The one place the spec uses a literal is the "taken" block, `#e8eaf3`. We derive
it instead — `color-mix(in srgb, var(--ink) 8%, var(--page))` — so booked time
tracks the salon's ground rather than staying faintly blue on a warm theme.

**4. The theme is data, not code.** `ACTIVE_THEME` is one constant today because
the POC is single-salon (`DESIGN.md` §2 — do not build multi-tenancy now). It is
shaped as a plain record so that becoming `salons/{salonId}.theme` is a change to
one provider, not to any component. Components read CSS variables and never
import the theme object.

### The test

**Change `--brand` alone. If the whole app re-themes with no other edit, the
principle holds. If anything stays purple, that's the bug.**

`/theme` renders the same components under every preset in `THEME_PRESETS` side
by side — that page failing to look right is the fastest signal something got
hard-coded.

---

## Adding a salon theme

Append to `THEME_PRESETS` in `lib/theme.ts`:

```ts
{
  name: 'Rose Atelier',
  brand: '#c2426e',
  page:  '#faf4f5',
  card:  '#fffdfd',
  ink:   '#2b2126',
  line:  '#eddfe3',
  radius: '14px',
}
```

Then open `/theme` and check it. Two things to look at:

- **Contrast.** Nocturne tunes accent-to-ground to at least 3:1 — fine for
  icons, large text, and chrome, **not for body copy**. Accent-coloured
  paragraph text uses `--brand-text` (the accent mixed toward ink), never raw
  `--brand`.
- **Radius carries more than you'd think.** 4px reads clinical, 14px reads soft.
  It is a real part of a salon's character, which is why it is one of the six.

## Where the tokens are used

| Token | Used for |
|---|---|
| `--brand` | Picked slot fill, selected date, icon accents |
| `--brand-text` | Accent text on a card — links, prices, "4 open" |
| `--brand-wash` (9%) | The AI proposal card ground |
| `--brand-tint` (12%) | Open slots, primary button, chips |
| `--brand-tint-strong` (20%) | Slot and primary-button hover |
| `--ink-58 / -55 / -45 / -40` | Secondary text, meta, fine print, chevrons |
| `--taken` | Booked and out-of-shift blocks |
| `--space-1…8` | Every gap and pad |

## Open question, not yet decided

**Dark mode.** 2a is a light direction and the spec has no dark variant, while
Nocturne underneath is natively dark. The old `prefers-color-scheme: dark` block
has been removed rather than left half-applied. If dark mode is wanted, the
right move is a second `SalonTheme` per salon (a `dark` alongside `light`) —
which the six-token shape already supports — rather than a media query that
guesses. Tracked in the design-foundation issue.
