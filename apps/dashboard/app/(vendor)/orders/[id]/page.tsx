'use client';

import { useParams } from 'next/navigation';
import { VendorOrderDetailView } from '../../../../components/vendor/VendorOrderDetailView';

export default function VendorOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <VendorOrderDetailView id={id} />;
}
