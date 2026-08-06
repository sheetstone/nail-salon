import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';

import { AuthProvider } from '@/components/AuthProvider';
import { ACTIVE_THEME, themeToCssVars } from '@/lib/theme';
import './globals.css';

// Nocturne's type face, self-hosted by next/font — no render-blocking
// request to Google, and no layout shift.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Polish Bar — Book a stylist',
  description:
    'Book a nail appointment, or describe what you want and let us find you a time.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Polish Bar' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#b04a6f',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The salon's six tokens are applied once, here. Every component below
    // reads them as CSS variables and never imports the theme object — which
    // is what lets ACTIVE_THEME become a per-salon Firestore doc later without
    // touching a single component. See DESIGN-SYSTEM.md.
    <html lang="en" className={inter.variable} style={themeToCssVars(ACTIVE_THEME)}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
