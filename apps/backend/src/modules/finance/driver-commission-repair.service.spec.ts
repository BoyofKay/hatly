import { DriverCommissionRepairService } from './driver-commission-repair.service';
import { Role } from '../../common/enums/role.enum';

const actor={id:'admin',role:Role.SUPER_ADMIN};
const row={id:'o1',order_number:'HT-100001',delivery_id:'d1',delivered_at:new Date('2026-11-24T08:00:00Z'),
  delivery_fee_minor:2000,delivery_fee_breakdown_snapshot:{baseFeeMinor:1000,multiplierUsed:2,chargeMinor:2000,service:'HATLY'},payment_method:'COD',amount_due_minor:3000,total_minor:3000};
function harness(rows:any[]=[row]) {
  const m={query:jest.fn(async(sql:string)=>sql.includes('SELECT o.id,')?rows:[])};
  const ds={manager:m,query:jest.fn(async()=>[{role:Role.ADMIN,staff_level:'OPS_SUPERVISOR'}]),transaction:async(fn:any)=>fn(m)};
  const events={record:jest.fn(async()=>({id:'event'}))};
  return {service:new DriverCommissionRepairService(ds as any,events as any),events};
}
describe('audited missing commission repair',()=>{
  it('requires exact eligible orders, preserves the service premium and never writes during preview',async()=>{
    const {service,events}=harness();
    const p=await service.preview(actor,'driver',['HT-100001'],0);
    expect(p.rows[0]).toMatchObject({driverCompensationMinor:1000,hatlyServiceRevenueMinor:1000,commissionMinor:0});
    expect(events.record).not.toHaveBeenCalled();
    await service.apply(actor,'driver',['HT-100001'],0,p.previewToken,'Approved missing rate correction');
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({amountMinor:0,actorUserId:'admin',reason:'Approved missing rate correction',
      rateSnapshot:expect.objectContaining({commissionRateBasisPoints:0,baseAmountMinor:1000})}),expect.anything());
  });
  it('rejects supervisors, unknown orders and a stale preview without writing',async()=>{
    const {service,events}=harness();
    await expect(service.preview({id:'ops',role:Role.ADMIN},'driver',['HT-100001'],0)).rejects.toThrow();
    await expect(service.preview(actor,'driver',['HT-100001','HT-100002'],0)).rejects.toThrow();
    await expect(service.apply(actor,'driver',['HT-100001'],0,'stale','Approved missing rate correction')).rejects.toThrow();
    expect(events.record).not.toHaveBeenCalled();
  });
});
