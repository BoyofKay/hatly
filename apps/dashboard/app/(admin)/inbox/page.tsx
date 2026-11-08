'use client';

import { NotificationCenter } from '../../../components/notifications/NotificationCenter';
import { OpsAlertsPanel } from '../../../components/alerts/OpsAlertsPanel';
import { fetchAdminChanges } from '../../../lib/api/changes';
import { adminHref } from '../../../lib/notifications/wording';
import { usePermissions } from '../../../lib/ui/permissions';

/** The Operations Notification Center (`/inbox`; the Vendor area uses `/notifications` — the two areas never share a path). */
export default function AdminInboxPage() {
  const { can } = usePermissions();
  return (
    <>
      <OpsAlertsPanel />
      <NotificationCenter hrefFor={(a) => adminHref(a, can)} changes={(since) => fetchAdminChanges('orders,exceptions', since)} />
    </>
  );
}
