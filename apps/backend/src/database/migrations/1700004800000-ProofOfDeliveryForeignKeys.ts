import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M5 Batch 3 — referential integrity for `proof_of_deliveries`. The table (1700004700000) was created WITHOUT foreign keys on
 * the claim that this schema's convention is no FKs on join columns. That premise had already been corrected in Group 7A
 * (1700003800000-LedgerReferentialIntegrity): evidence/ledger tables DO get real foreign keys, because rows are never
 * hard-deleted, so a constraint adds integrity without changing runtime behaviour. Proof of Delivery is append-only evidence
 * and its entity declares the three relations, so it gets the same treatment.
 *
 * A new migration, not an edit: 1700004700000 may already be applied. ON DELETE is NO ACTION — deleting an order, delivery or
 * driver that has Proof of Delivery history is refused, never cascaded. Same safety as 7A: one transaction, orphan pre-check
 * that REFUSES (naming each column and count) and never deletes, nulls or rewrites data.
 */
const FOREIGN_KEYS = [
  { column: 'order_id', references: 'orders' },
  { column: 'delivery_id', references: 'deliveries' },
  { column: 'driver_id', references: 'drivers' },
] as const;

const constraintName = (column: string): string => `fk_proof_of_deliveries_${column}`;

export class ProofOfDeliveryForeignKeys1700004800000 implements MigrationInterface {
  name = 'ProofOfDeliveryForeignKeys1700004800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const orphaned: string[] = [];
    for (const fk of FOREIGN_KEYS) {
      const [{ n }] = await queryRunner.query(
        `SELECT count(*)::int AS n FROM "proof_of_deliveries" t
         WHERE NOT EXISTS (SELECT 1 FROM "${fk.references}" p WHERE p."id" = t."${fk.column}")`,
      );
      if (n > 0) orphaned.push(`proof_of_deliveries.${fk.column} -> ${fk.references}: ${n} orphan row(s)`);
    }
    if (orphaned.length > 0) {
      throw new Error(
        `Refusing to add foreign keys — existing rows reference records that do not exist. ` +
          `No data was changed; remediate these deliberately, then re-run: ${orphaned.join('; ')}`,
      );
    }
    for (const fk of FOREIGN_KEYS) {
      await queryRunner.query(
        `ALTER TABLE "proof_of_deliveries" ADD CONSTRAINT "${constraintName(fk.column)}" ` +
          `FOREIGN KEY ("${fk.column}") REFERENCES "${fk.references}" ("id") ON DELETE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const fk of [...FOREIGN_KEYS].reverse()) {
      await queryRunner.query(`ALTER TABLE "proof_of_deliveries" DROP CONSTRAINT IF EXISTS "${constraintName(fk.column)}"`);
    }
  }
}
