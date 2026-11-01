import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Delete your Hatly account — حذف حساب Hatly',
  description: 'Request deletion of your Hatly customer account and its data, without the app.',
  robots: { index: true, follow: false },
};

export default function AccountDeletionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
