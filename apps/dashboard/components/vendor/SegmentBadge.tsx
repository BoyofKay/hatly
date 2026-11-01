'use client';

import { useLang } from '../../lib/ui/lang';
import { SEGMENT_STATUS, STATUS_TONE, pick } from '../../lib/vendor/labels';

/** A vendor-part status as a coloured, bilingual badge. */
export function SegmentBadge({ status }: { status: string }) {
  const { t } = useLang();
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[status] ?? 'bg-gray-100 text-gray-700 ring-gray-200'}`}>{pick(SEGMENT_STATUS, status, t)}</span>;
}
