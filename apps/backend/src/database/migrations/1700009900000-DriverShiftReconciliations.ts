import { MigrationInterface, QueryRunner } from 'typeorm';

export class DriverShiftReconciliations1700009900000 implements MigrationInterface {
  name = 'DriverShiftReconciliations1700009900000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE driver_shift_reconciliations (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      shift_id uuid NOT NULL REFERENCES driver_shifts(id),
      period_id uuid NOT NULL REFERENCES driver_settlement_periods(id),
      from_at timestamptz NOT NULL,
      to_at timestamptz NOT NULL,
      reconciled_by_user_id uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (to_at > from_at),
      UNIQUE (shift_id, from_at),
      UNIQUE (shift_id, period_id)
    )`);
    await q.query('CREATE INDEX idx_shift_reconciliations_period ON driver_shift_reconciliations(period_id)');
    // Only migrate evidence already recorded by the old closing mechanism.
    await q.query(`INSERT INTO driver_shift_reconciliations (shift_id, period_id, from_at, to_at, reconciled_by_user_id)
      SELECT s.id, s.closing_period_id, s.started_at, s.ended_at, p.closed_by_user_id
      FROM driver_shifts s JOIN driver_settlement_periods p ON p.id = s.closing_period_id
      WHERE s.ended_at > s.started_at`);
  }
  async down(q: QueryRunner): Promise<void> {
    const [r] = await q.query(`SELECT count(*)::int AS n FROM driver_shift_reconciliations i JOIN driver_shifts s ON s.id=i.shift_id
      WHERE s.closing_period_id IS DISTINCT FROM i.period_id OR s.started_at <> i.from_at OR s.ended_at IS DISTINCT FROM i.to_at`);
    if (Number(r.n)) throw new Error('Cannot discard new working-time reconciliation records.');
    await q.query('DROP TABLE driver_shift_reconciliations');
  }
}
