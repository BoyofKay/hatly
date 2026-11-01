'use client';

import { NotificationCenter } from '../../../components/notifications/NotificationCenter';
import { fetchVendorChanges } from '../../../lib/api/changes';
import { vendorHref } from '../../../lib/notifications/wording';

/** The Vendor Notification Center: only the signed-in person's own rows, of their own branches (scoped by the server). */
export default function VendorNotificationsPage() {
  return <NotificationCenter hrefFor={vendorHref} changes={fetchVendorChanges} />;
}
