import { ACTIVE_DELIVERY_CONDITION } from './driver-capacity';
type Db = { query(sql: string, params?: unknown[]): Promise<any> };
export const RISK_KEYS = ['DRIVER_CASH_WARNING_MINOR','DRIVER_CASH_CAP_MINOR','DRIVER_ALLOWANCE_CAP_MINOR'] as const;
export async function driverRiskLimits(db: Db) {
  const rows: Array<{key:string;value:unknown}> = await db.query(
    'SELECT key,value FROM business_config WHERE key=ANY($1::text[]) AND deleted_at IS NULL',[RISK_KEYS]);
  const get=(key:string):number|null=>{
    const value=rows.find(r=>r.key===key)?.value;
    return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
  };
  return {warningMinor:get(RISK_KEYS[0]),capMinor:get(RISK_KEYS[1]),allowanceCapMinor:get(RISK_KEYS[2])};
}

/**
 * Dispatch risk, not a new settlement formula. Unclosed COD cash is counted
 * even when a missing commission or pending change prevents financial closing.
 * Closed collection liabilities remain outstanding until recorded payments.
 * Active COD orders reserve the full expected collection, conservatively.
 */
export async function driverCashExposure(db:Db, driverId:string, candidateOrderId:string|null=null) {
  const [r] = await db.query(`SELECT
    coalesce((
      SELECT sum(greatest(0,coalesce(o.amount_due_minor,o.total_minor,0) -
        coalesce((SELECT sum(s.subtotal_minor) FROM order_vendor_segments s WHERE s.order_id=o.id AND s.deleted_at IS NULL
          AND s.group_type='CATALOG' AND s.vendor_branch_id IS NOT NULL AND s.status<>'CANCELLED'),0) -
        coalesce((SELECT sum(p.amount_minor) FROM ad_hoc_purchase_records p JOIN order_items i ON i.id=p.order_item_id
          JOIN order_vendor_segments g ON g.id=i.order_vendor_segment_id WHERE g.order_id=o.id),0))
        + coalesce((SELECT sum(c.remainder_amount_minor) FROM driver_cash_remainders c
          WHERE c.order_id=o.id AND c.status IN ('APPROVED','PENDING_REVIEW')),0))
      FROM deliveries d JOIN orders o ON o.id=d.order_id
      WHERE d.driver_id=$1 AND d.deleted_at IS NULL AND o.deleted_at IS NULL AND o.status='DELIVERED'
        AND o.payment_method::text IN ('COD','PAY_AT_DELIVERY')
        AND NOT EXISTS(SELECT 1 FROM driver_settlement_period_orders so WHERE so.order_id=o.id)
        AND NOT EXISTS(SELECT 1 FROM driver_settlement_periods p WHERE p.driver_id=$1 AND p.method_version=1 AND p.status='CLOSED' AND p.deleted_at IS NULL
          AND EXISTS(SELECT 1 FROM financial_events e WHERE e.order_id=o.id AND e.driver_id=$1 AND e.type IN ('DRIVER_COMMISSION_RECOGNIZED','DRIVER_REIMBURSEMENT_OWED') AND e.created_at>=p.period_start AND e.created_at<p.period_end))
    ),0) AS unclosed,
    coalesce((
      SELECT sum(greatest(0,-p.net_payable_minor-coalesce((SELECT sum(s.amount_minor) FROM settlement_payments s
        WHERE s.driver_period_id=p.id AND s.status='RECORDED'),0)))
      FROM driver_settlement_periods p WHERE p.driver_id=$1 AND p.status='CLOSED' AND p.deleted_at IS NULL AND p.net_payable_minor<0
    ),0) AS closed_uncollected,
    coalesce((
      SELECT sum(coalesce(o.amount_due_minor,o.total_minor,0)) FROM deliveries d JOIN orders o ON o.id=d.order_id
      WHERE d.driver_id=$1 AND d.deleted_at IS NULL AND o.deleted_at IS NULL AND o.id IS DISTINCT FROM $2::uuid
        AND o.payment_method::text IN ('COD','PAY_AT_DELIVERY') AND ${ACTIVE_DELIVERY_CONDITION('d','o')}
    ),0) AS reserved,
    coalesce((SELECT coalesce(o.amount_due_minor,o.total_minor,0) FROM orders o WHERE o.id=$2::uuid
       AND o.payment_method::text IN ('COD','PAY_AT_DELIVERY')),0) AS candidate`,[driverId,candidateOrderId]);
  const unclosedMinor=Number(r?.unclosed??0),closedUncollectedMinor=Number(r?.closed_uncollected??0);
  const outstandingMinor=unclosedMinor+closedUncollectedMinor;
  const reservedMinor=Number(r?.reserved??0),candidateMinor=Number(r?.candidate??0);
  return {unclosedMinor,closedUncollectedMinor,outstandingMinor,reservedMinor,candidateMinor,projectedMinor:outstandingMinor+reservedMinor+candidateMinor};
}
export function cashCapBlocks(cap:number|null, outstanding:number, projected:number):boolean {
  return cap!==null&&(outstanding>=cap||projected>cap);
}
/** Invoke under the existing per-driver row lock on every assignment path. */
export async function canTakeFinancialRisk(db:Db,driverId:string,orderId:string):Promise<boolean>{
  const {capMinor}=await driverRiskLimits(db);
  if(capMinor===null)return true;
  const e=await driverCashExposure(db,driverId,orderId);
  return !cashCapBlocks(capMinor,e.outstandingMinor,e.projectedMinor);
}
