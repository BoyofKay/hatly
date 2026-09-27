import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hatly Dashboard',
  description: 'Vendor and Admin dashboard for the Hatly delivery platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
