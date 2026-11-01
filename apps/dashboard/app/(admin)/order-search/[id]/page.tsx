'use client';

import { useParams } from 'next/navigation';
import { OrderDetailView } from '../../../../components/orders/OrderDetailView';

/** The full-page order view (deep links, bookmarks). The same body also opens as a drawer inside the Orders workspace. */
export default function OrderSearchDetailPage() {
  const params = useParams();
  return <OrderDetailView orderId={params.id as string} />;
}
