'use client';

import Link from 'next/link';
import { DISPATCH_ALERT_REASONS, OperationsFacts } from '../../lib/api/admin-control-tower';
import { useI18n } from '../../lib/i18n/i18n';
import { MessageKey } from '../../lib/i18n/messages';

/** Control Tower: the order-operations facts (acceptance backlog, overdue preparation, open alerts by reason, refunds to send). Counts only. */
export function OperationsFactsCard({ facts }: { facts: OperationsFacts }) {
  const { t } = useI18n();
  const row = (testId: string, label: string, value: number, hot: boolean, href?: string) => (
    <li data-testid={testId} className={hot ? 'font-medium text-red-700' : ''}>
      {href ? (
        <Link href={href} className="hover:underline">
          <b>{value}</b> {label}
        </Link>
      ) : (
        <>
          <b>{value}</b> {label}
        </>
      )}
    </li>
  );
  return (
    <section className="rounded-xl border bg-white p-4 md:col-span-3 border-gray-200 shadow-sm" data-testid="ct-operations">
      <h2 className="font-medium">
        {t('opCtTitle')} — {t('opCtActionRequired')}: <b data-testid="ct-action-required">{facts.actionRequired}</b>
      </h2>
      <ul className="mt-2 grid gap-1 text-sm md:grid-cols-2">
        {row('ct-pending-acceptance', t('opCtPendingAcceptance'), facts.pendingAcceptance, false)}
        {row('ct-pending-overdue', t('opCtPendingOverdue', { minutes: facts.pendingAcceptanceAlertMinutes }), facts.pendingAcceptanceOverdue, facts.pendingAcceptanceOverdue > 0)}
        {row('ct-prep-overdue', t('opCtPrepOverdue'), facts.preparationOverdue, facts.preparationOverdue > 0)}
        {row('ct-partial', t('opCtPartial'), facts.partiallyRejectedActiveOrders, false)}
        {row('ct-refunds-to-send', t('opCtRefundsToSend'), facts.refundsToSend, facts.refundsToSend > 0, '/manual-transfer')}
      </ul>
      <h3 className="mt-3 text-xs font-medium uppercase text-gray-500">{t('opCtOpenAlerts')}</h3>
      <ul className="mt-1 grid gap-1 text-sm md:grid-cols-2">
        {DISPATCH_ALERT_REASONS.map((reason) =>
          row(`ct-alert-count-${reason}`, t(`opReason_${reason}` as MessageKey), facts.openDispatchAlerts[reason], facts.openDispatchAlerts[reason] > 0),
        )}
      </ul>
    </section>
  );
}
