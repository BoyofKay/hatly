import { EntityManager } from 'typeorm';

/** The one sequence every order number (new or backfilled) is drawn from — see the `OrderNumber` migration. */
export const ORDER_NUMBER_SEQUENCE = 'order_number_seq';

/** `HT-100234` — a prefix plus the zero-padded sequence value (never truncated if it grows past 6 digits). */
export function formatOrderNumber(sequenceValue: number | string): string {
  return `HT-${String(sequenceValue).padStart(6, '0')}`;
}

/**
 * Draws the next order number from the shared Postgres sequence — concurrency-safe (a sequence never hands out the same value
 * twice, with or without a transaction) and independent of any row lock. Called once per order, inside the same transaction that
 * persists it, so a rolled-back order simply leaves a gap in the sequence rather than a reused number.
 */
export async function nextOrderNumber(manager: EntityManager): Promise<string> {
  const [{ seq }] = await manager.query(`SELECT nextval('${ORDER_NUMBER_SEQUENCE}') AS seq`);
  return formatOrderNumber(seq as string);
}

/** A plausible `HT-NNNNNN` reference, for validating a support/admin lookup input before it ever reaches the database. */
export function isOrderNumber(value: string): boolean {
  return /^HT-\d{6,}$/.test(value);
}
