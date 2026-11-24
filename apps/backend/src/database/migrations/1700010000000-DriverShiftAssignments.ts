import { MigrationInterface, QueryRunner } from 'typeorm';

/** Operational attribution, independent of financial closing and dispatch acceptance analytics. */
export class DriverShiftAssignments1700010000000 implements MigrationInterface {
  name = 'DriverShiftAssignments1700010000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE driver_shift_assignments (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      shift_id uuid REFERENCES driver_shifts(id),
      driver_id uuid NOT NULL REFERENCES drivers(id),
      delivery_id uuid NOT NULL REFERENCES deliveries(id),
      order_id uuid NOT NULL REFERENCES orders(id),
      assigned_at timestamptz NOT NULL,
      acknowledge_by timestamptz,
      acknowledged_at timestamptz,
      status varchar(32) NOT NULL,
      concluded_at timestamptz,
      attribution varchar(20) NOT NULL DEFAULT 'RECORDED',
      UNIQUE (delivery_id, driver_id, assigned_at)
    )`);
    await q.query('CREATE INDEX idx_shift_assignment_scope ON driver_shift_assignments(driver_id, shift_id, order_id)');
    // Recover only current assignment evidence; never fabricate overwritten previous assignments.
    await q.query(`INSERT INTO driver_shift_assignments
      (shift_id,driver_id,delivery_id,order_id,assigned_at,acknowledge_by,acknowledged_at,status,concluded_at,attribution)
      SELECT sh.id,d.driver_id,d.id,d.order_id,d.assigned_at,d.accept_deadline_at,d.acknowledged_at,
        CASE WHEN o.status::text='READY_FOR_PICKUP' AND d.early_assigned_at IS NULL THEN 'REASSIGNED' ELSE o.status::text END,
        CASE WHEN o.status::text IN ('DELIVERED','CANCELLED','FAILED_DELIVERY','COLLECTED') OR (o.status::text='READY_FOR_PICKUP' AND d.early_assigned_at IS NULL)
          THEN coalesce(d.delivered_at,o.updated_at) END,
        CASE WHEN sh.id IS NULL THEN 'UNATTRIBUTED' ELSE 'RECOVERED' END
      FROM deliveries d JOIN orders o ON o.id=d.order_id
      LEFT JOIN LATERAL (SELECT id FROM driver_shifts s WHERE s.driver_id=d.driver_id AND s.started_at<=d.assigned_at
        AND (s.ended_at IS NULL OR s.ended_at>=d.assigned_at) ORDER BY s.started_at DESC LIMIT 1) sh ON true
      WHERE d.driver_id IS NOT NULL AND d.assigned_at IS NOT NULL AND d.deleted_at IS NULL AND o.deleted_at IS NULL`);
    await q.query(`CREATE FUNCTION hatly_capture_driver_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE st text; sid uuid; changed boolean;
    BEGIN
      changed := TG_OP = 'INSERT';
      IF TG_OP = 'UPDATE' THEN
        changed := OLD.driver_id IS DISTINCT FROM NEW.driver_id OR OLD.assigned_at IS DISTINCT FROM NEW.assigned_at;
        IF changed AND OLD.driver_id IS NOT NULL THEN
          UPDATE driver_shift_assignments SET status='REASSIGNED', concluded_at=clock_timestamp()
            WHERE delivery_id=OLD.id AND driver_id=OLD.driver_id AND assigned_at=OLD.assigned_at AND concluded_at IS NULL;
        END IF;
      END IF;
      IF NEW.driver_id IS NULL OR NEW.assigned_at IS NULL THEN RETURN NEW; END IF;
      IF changed THEN
        SELECT id INTO sid FROM driver_shifts WHERE driver_id=NEW.driver_id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1;
        SELECT status::text INTO st FROM orders WHERE id=NEW.order_id;
        IF st='READY_FOR_PICKUP' AND NEW.early_assigned_at IS NULL THEN st := 'ASSIGNED_TO_DRIVER'; END IF;
        INSERT INTO driver_shift_assignments (shift_id,driver_id,delivery_id,order_id,assigned_at,acknowledge_by,acknowledged_at,status,attribution)
          VALUES (sid,NEW.driver_id,NEW.id,NEW.order_id,NEW.assigned_at,NEW.accept_deadline_at,NEW.acknowledged_at,st,
            CASE WHEN sid IS NULL THEN 'UNATTRIBUTED' ELSE 'RECORDED' END)
          ON CONFLICT (delivery_id,driver_id,assigned_at) DO NOTHING;
      ELSE
        UPDATE driver_shift_assignments SET acknowledged_at=NEW.acknowledged_at, acknowledge_by=NEW.accept_deadline_at
          WHERE delivery_id=NEW.id AND driver_id=NEW.driver_id AND assigned_at=NEW.assigned_at AND concluded_at IS NULL;
      END IF;
      RETURN NEW;
    END $$`);
    await q.query('CREATE TRIGGER trg_capture_driver_assignment AFTER INSERT OR UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION hatly_capture_driver_assignment()');
    await q.query(`CREATE FUNCTION hatly_capture_driver_assignment_status() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE driver_shift_assignments a SET
        status=CASE WHEN OLD.status::text='ASSIGNED_TO_DRIVER' AND NEW.status::text='READY_FOR_PICKUP' THEN 'REASSIGNED' ELSE NEW.status::text END,
        concluded_at=CASE WHEN NEW.status::text IN ('DELIVERED','CANCELLED','FAILED_DELIVERY','COLLECTED')
          OR (OLD.status::text='ASSIGNED_TO_DRIVER' AND NEW.status::text='READY_FOR_PICKUP') THEN clock_timestamp() ELSE NULL END
        FROM deliveries d WHERE d.order_id=NEW.id AND a.delivery_id=d.id AND a.driver_id=d.driver_id
          AND a.assigned_at=d.assigned_at AND a.concluded_at IS NULL;
      RETURN NEW;
    END $$`);
    await q.query('CREATE TRIGGER trg_capture_assignment_status AFTER UPDATE OF status ON orders FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION hatly_capture_driver_assignment_status()');
  }
  async down(q: QueryRunner): Promise<void> {
    const [r] = await q.query("SELECT count(*)::int AS n FROM driver_shift_assignments WHERE attribution='RECORDED'");
    if (Number(r.n)) throw new Error('Cannot discard newly recorded assignment history.');
    await q.query('DROP TRIGGER trg_capture_assignment_status ON orders');
    await q.query('DROP FUNCTION hatly_capture_driver_assignment_status()');
    await q.query('DROP TRIGGER trg_capture_driver_assignment ON deliveries');
    await q.query('DROP FUNCTION hatly_capture_driver_assignment()');
    await q.query('DROP TABLE driver_shift_assignments');
  }
}
