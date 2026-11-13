'use client';

import { OperationsBoard } from '../../../components/operations/OperationsBoard';
import { PageHeader } from '../../../components/ui';
import { useLang } from '../../../lib/ui/lang';

/** The Operations board on its own page (first tab of the Orders section). */
export default function OperationsPage() {
  const { t } = useLang();
  return (
    <div className="space-y-4">
      <PageHeader title={t('Operations board', 'لوحة التشغيل')} subtitle={t('What needs doing now, most urgent first. The next step is on each order.', 'ما يحتاج إجراء الآن، الأهم أولًا. الخطوة التالية على كل طلب.')} />
      <OperationsBoard />
    </div>
  );
}
