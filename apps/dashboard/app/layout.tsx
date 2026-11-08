import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hatly Dashboard',
  description: 'Vendor and Admin dashboard for the Hatly delivery platform',
  // Installable (Add to Home screen) so Android/desktop can run Hatly Admin as an app; push alerts work with or without installing.
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
  appleWebApp: { capable: true, title: 'Hatly Admin' },
};
export const viewport: Viewport = { themeColor: '#ff7a1a' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
