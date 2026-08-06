/**
 * Salon theming — the seam that lets every salon look like itself.
 *
 * THE RULE: a salon's entire visual identity is these six values. Nothing else.
 * If you find yourself adding a seventh to make one screen work, the screen is
 * wrong, not the theme. See DESIGN-SYSTEM.md for the full principle.
 *
 * Today this is one constant, because the POC is single-salon (DESIGN.md §2).
 * It is shaped as a record so it becomes `salons/{salonId}.theme` later without
 * touching a single component — components read CSS variables, never this
 * object, so the switch from constant to Firestore doc is one provider change.
 */

export interface SalonTheme {
  /** Display name, for the theme picker and the preview page. */
  name: string;
  /** The one accent. Every tint, chip, button, and picked block derives from it. */
  brand: string;
  /** App background — the ground everything sits on. */
  page: string;
  /** Card/sheet surface, one step up from `page`. */
  card: string;
  /** Primary text. All muted greys are this at reduced alpha. */
  ink: string;
  /** Hairline borders and dividers. */
  line: string;
  /** Corner radius for cards and controls. */
  radius: string;
}

/**
 * The design's own default — direction 2a, "Day timeline, daylight".
 * Values lifted verbatim from `Booking Redesign.dc.html`.
 */
export const POLISH_BAR: SalonTheme = {
  name: 'Polish Bar',
  brand: '#7a5af0',
  page: '#f1f2f9',
  card: '#fdfdff',
  ink: '#23252f',
  line: '#e0e3ef',
  radius: '8px',
};

/**
 * Presets proving the range. Each is *only* a swap of the six values above —
 * no component, no layout, and no per-theme CSS anywhere in the app.
 */
export const THEME_PRESETS: SalonTheme[] = [
  POLISH_BAR,
  {
    // The Nocturne accent the design system ships with.
    name: 'Nocturne',
    brand: '#9184d9',
    page: '#f2f2f7',
    card: '#fdfdff',
    ink: '#23252f',
    line: '#e2e2ec',
    radius: '8px',
  },
  {
    name: 'Rose Atelier',
    brand: '#c2426e',
    page: '#faf4f5',
    card: '#fffdfd',
    ink: '#2b2126',
    line: '#eddfe3',
    radius: '14px',
  },
  {
    name: 'Jade Room',
    brand: '#0f8a72',
    page: '#f0f6f4',
    card: '#fcfefd',
    ink: '#1d2926',
    line: '#d9e8e3',
    radius: '4px',
  },
  {
    name: 'Amber Studio',
    brand: '#b26a12',
    page: '#faf6f0',
    card: '#fffdfa',
    ink: '#2a2419',
    line: '#ece0cf',
    radius: '10px',
  },
];

/**
 * Serialises a theme to the CSS custom properties the stylesheet expects.
 *
 * Only the six roots are emitted. Every derived value — tints, washes, muted
 * text, the "taken" grey — is computed in CSS from these via `color-mix()`, so
 * a theme author never has to supply (or get wrong) a tint ramp.
 */
export function themeToCssVars(theme: SalonTheme): Record<string, string> {
  return {
    '--brand': theme.brand,
    '--page': theme.page,
    '--card': theme.card,
    '--ink': theme.ink,
    '--line': theme.line,
    '--card-radius': theme.radius,
  };
}

/** Same, as an inline `style` string for a wrapper element. */
export function themeToStyleAttr(theme: SalonTheme): string {
  return Object.entries(themeToCssVars(theme))
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}

/** The theme in force. One line to change for the whole app. */
export const ACTIVE_THEME: SalonTheme = POLISH_BAR;
