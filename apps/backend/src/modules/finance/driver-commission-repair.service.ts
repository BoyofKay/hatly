import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import { FinancialEventService } from './financial-event.service';
import { FinancialEventDirection, FinancialEventType } from './financial-event-type.enum';
import { splitDriverCompensation } from './driver-compensation-split';

@Injectable()
export class DriverCommissionRepairService {
  constructor(private readonly ds: DataSource, private readonly events: FinancialEventService) {}

  private async assertAdmin(actor: AuthenticatedUser) {
    if (actor.role === Role.SUPER_ADMIN) return;
    const [u] = await this.ds.query('SELECT role,staff_level FROM users WHERE id=$1 AND deleted_at IS NULL',[actor.id]);
    if (actor.role !== Role.ADMIN || u?.role !== Role.ADMIN || (u.staff_level ?? 'ADMIN') !== 'ADMIN')
      throw new ForbiddenException('Only Admin-level staff may make a financial correction.');
  }

  private async facts(m: EntityManager, driverId:string, numbers:string[], lock=false) {
    if (!Array.isArray(numbers)||numbers.length<1||numbers.length>50||new Set(numbers).size!==numbers.length||
      numbers.some(n=>typeof n!=='string'||!/^HT-[0-9]+$/.test(n))) throw new BadRequestException('Select distinct order numbers.');
    const rows = await m.query(`SELECT o.id,o.order_number,o.delivery_fee_minor,o.delivery_fee_breakdown_snapshot,o.payment_method,
      o.amount_due_minor,o.total_minor,d.id AS delivery_id,
      (SELECT max(se.created_at) FROM order_status_events se WHERE se.order_id=o.id AND se.to_status='DELIVERED') AS delivered_at
      FROM orders o JOIN deliveries d ON d.order_id=o.id AND d.deleted_at IS NULL
      WHERE d.driver_id=$1 AND o.order_number=ANY($2::text[]) AND o.deleted_at IS NULL AND o.status='DELIVERED'
        AND o.delivery_fee_minor IS NOT NULL AND o.delivery_fee_minor>=0
        AND NOT EXISTS (SELECT 1 FROM financial_events e WHERE e.order_id=o.id AND e.type='DRIVER_COMMISSION_RECOGNIZED')
        AND NOT EXISTS (SELECT 1 FROM driver_settlement_period_orders l WHERE l.order_id=o.id)
        AND NOT EXISTS (SELECT 1 FROM driver_settlement_periods p WHERE p.driver_id=$1 AND p.method_version=1 AND p.status='CLOSED' AND p.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM financial_events e WHERE e.order_id=o.id AND e.driver_id=$1 AND e.type IN ('DRIVER_COMMISSION_RECOGNIZED','DRIVER_REIMBURSEMENT_OWED') AND e.created_at>=p.period_start AND e.created_at<p.period_end))
      ORDER BY o.id ${lock?'FOR UPDATE OF o,d':''}`,[driverId,numbers]);
    if(rows.length!==numbers.length || rows.some((r:any)=>!r.delivered_at || !Number.isSafeInteger(Number(r.delivery_fee_minor))))
      throw new ConflictException({message:'One or more selected orders are not eligible for missing-commission repair.',details:{code:'REPAIR_NOT_ELIGIBLE'}});
    return rows.map((r:any)=>({orderId:r.id,orderNumber:r.order_number,deliveryId:r.delivery_id,
      deliveredAt:new Date(r.delivered_at).toISOString(),paymentMethod:r.payment_method,amountDueMinor:r.amount_due_minor,totalMinor:r.total_minor,
      deliveryChargeMinor:Number(r.delivery_fee_minor),...splitDriverCompensation(Number(r.delivery_fee_minor),r.delivery_fee_breakdown_snapshot)}));
  }

  private token(driverId:string,rows:unknown[],rate:number) {
    return createHash('sha256').update(JSON.stringify({driverId,rows,rate})).digest('hex');
  }
  async preview(actor:AuthenticatedUser,driverId:string,numbers:string[],rate:number) {
    await this.assertAdmin(actor);
    if(!Number.isInteger(rate)||rate<0||rate>10000)throw new BadRequestException('Enter an explicit rate between 0% and 100%.');
    const rows=await this.facts(this.ds.manager,driverId,numbers);
    return {rows:rows.map((r:any)=>({...r,commissionMinor:Math.round(r.driverCompensationMinor*rate/10000)})),rateBasisPoints:rate,previewToken:this.token(driverId,rows,rate)};
  }
  async apply(actor:AuthenticatedUser,driverId:string,numbers:string[],rate:number,token:string,reason:string) {
    await this.assertAdmin(actor);
    if(!Number.isInteger(rate)||rate<0||rate>10000||typeof reason!=='string'||reason.trim().length<10||reason.length>500)
      throw new BadRequestException('An explicit valid rate and audit reason are required.');
    return this.ds.transaction(async m=>{
      await m.query("SELECT pg_advisory_xact_lock(hashtext('driver-settlement:' || $1))",[driverId]);
      await m.query('SELECT id FROM drivers WHERE id=$1 FOR UPDATE',[driverId]);
      const rows=await this.facts(m,driverId,numbers,true);
      if(token!==this.token(driverId,rows,rate))throw new ConflictException('Correction preview changed. Review again.');
      const saved=[];
      for(const row of rows) {
        const event=await this.events.record({
          type:FinancialEventType.DRIVER_COMMISSION_RECOGNIZED,direction:FinancialEventDirection.RECEIVABLE,
          idempotencyKey:`driver-commission:${row.orderId}`,orderId:row.orderId,deliveryId:row.deliveryId,driverId,
          amountMinor:Math.round(row.driverCompensationMinor*rate/10000),actorUserId:actor.id,reason:reason.trim(),
          rateSnapshot:{commissionRateBasisPoints:rate,baseAmountMinor:row.driverCompensationMinor,deliveryChargeMinor:row.deliveryChargeMinor,
            hatlyServiceRevenueMinor:row.hatlyServiceRevenueMinor,correction:'MISSING_COMMISSION',deliveredAt:row.deliveredAt},
        },m);
        saved.push({orderNumber:row.orderNumber,eventId:event.id});
      }
      // No payment, closing, rate update or other order mutation is performed.
      return {recorded:saved};
    });
  }
}
