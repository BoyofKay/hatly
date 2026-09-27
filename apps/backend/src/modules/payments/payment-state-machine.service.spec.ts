import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentStateMachineService } from './payment-state-machine.service';
import { PaymentStatus } from './payment-status.enum';
import { Role } from '../../common/enums/role.enum';

function buildHarness(payment: any) {
  const stored = { ...payment };
  const lockedEntities: string[] = [];
  const manager = {
    findOne: async (EntityClass: any, opts: any) => {
      if (opts?.lock) lockedEntities.push(EntityClass.name);
      return { ...stored, orderId: 'order-1' };
    },
    // `reanchorPreparationTiming` (fired on PAID) reads this order's segments — no segments here, so it is a safe no-op.
    find: async () => [],
    save: async (entity: any) => {
      Object.assign(stored, entity);
      return entity;
    },
  };
  const dataSource = { transaction: async (cb: any) => cb(manager) };
  const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };
  // PD-004 reconciliation has its own dedicated specs (manual-transfer-refund.service.spec.ts); here only the routing is checked.
  const manualTransferRefundService = {
    convertPendingRefund: jest.fn(async () => 0),
    voidPendingRefund: jest.fn(async () => undefined),
  };
  const service = new PaymentStateMachineService(dataSource as any, requestContextService as any, manualTransferRefundService as any);
  return { service, stored, manualTransferRefundService, lockedEntities, manager };
}

describe('PaymentStateMachineService', () => {
  it('allows CUSTOMER to claim a PENDING payment', async () => {
    const { service, stored } = buildHarness({ id: 'payment-1', status: PaymentStatus.PENDING });

    const result = await service.transition({
      paymentId: 'payment-1',
      to: PaymentStatus.CUSTOMER_CLAIMED_TRANSFER,
      actorRole: Role.CUSTOMER,
    });

    expect(result.status).toBe(PaymentStatus.CUSTOMER_CLAIMED_TRANSFER);
    expect(stored.claimedAt).toBeInstanceOf(Date);
  });

  it('allows the system actor (ADMIN) to auto-advance CUSTOMER_CLAIMED_TRANSFER to UNDER_REVIEW', async () => {
    const { service } = buildHarness({ id: 'payment-1', status: PaymentStatus.CUSTOMER_CLAIMED_TRANSFER });

    const result = await service.transition({
      paymentId: 'payment-1',
      to: PaymentStatus.UNDER_REVIEW,
      actorRole: Role.ADMIN,
    });

    expect(result.status).toBe(PaymentStatus.UNDER_REVIEW);
  });

  it('rejects CUSTOMER attempting to advance CUSTOMER_CLAIMED_TRANSFER to UNDER_REVIEW directly — confirmed to be system-only', async () => {
    const { service } = buildHarness({ id: 'payment-1', status: PaymentStatus.CUSTOMER_CLAIMED_TRANSFER });

    await expect(
      service.transition({ paymentId: 'payment-1', to: PaymentStatus.UNDER_REVIEW, actorRole: Role.CUSTOMER }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows ADMIN to approve (PAID) an UNDER_REVIEW payment, recording verifiedByUserId/verifiedAt', async () => {
    const { service, stored } = buildHarness({ id: 'payment-1', status: PaymentStatus.UNDER_REVIEW });

    const result = await service.transition({
      paymentId: 'payment-1',
      to: PaymentStatus.PAID,
      actorRole: Role.ADMIN,
      verifiedByUserId: 'admin-1',
    });

    expect(result.status).toBe(PaymentStatus.PAID);
    expect(stored.verifiedByUserId).toBe('admin-1');
    expect(stored.verifiedAt).toBeInstanceOf(Date);
  });

  it('allows ADMIN to reject an UNDER_REVIEW payment, recording the reason', async () => {
    const { service, stored } = buildHarness({ id: 'payment-1', status: PaymentStatus.UNDER_REVIEW });

    await service.transition({
      paymentId: 'payment-1',
      to: PaymentStatus.REJECTED,
      actorRole: Role.ADMIN,
      verifiedByUserId: 'admin-1',
      rejectionReason: 'Amount does not match',
    });

    expect(stored.status).toBe(PaymentStatus.REJECTED);
    expect(stored.rejectionReason).toBe('Amount does not match');
  });

  it('CONFIRMED RULE: PAID is terminal — any further transition attempt is rejected, never silently overwritten', async () => {
    const { service } = buildHarness({ id: 'payment-1', status: PaymentStatus.PAID });

    await expect(
      service.transition({ paymentId: 'payment-1', to: PaymentStatus.REJECTED, actorRole: Role.ADMIN }),
    ).rejects.toThrow(ConflictException);
  });

  it('CONFIRMED RULE: REJECTED is terminal — any further transition attempt is rejected', async () => {
    const { service } = buildHarness({ id: 'payment-1', status: PaymentStatus.REJECTED });

    await expect(
      service.transition({ paymentId: 'payment-1', to: PaymentStatus.PAID, actorRole: Role.ADMIN }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException for a non-existent payment', async () => {
    const manager = { findOne: async () => null };
    const dataSource = { transaction: async (cb: any) => cb(manager) };
    const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };
    const service = new PaymentStateMachineService(dataSource as any, requestContextService as any, {} as any);

    await expect(
      service.transition({ paymentId: 'missing', to: PaymentStatus.PAID, actorRole: Role.ADMIN }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('PaymentStateMachineService — structured business-event logging (Group 4)', () => {
  it('B: a successful transition logs payment.state_transition with correlation id, paymentId/orderId, from/to, and actor — post-commit', async () => {
    const { service } = buildHarness({ id: 'payment-1', orderId: 'order-1', status: PaymentStatus.UNDER_REVIEW });
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);

    await service.transition({ paymentId: 'payment-1', to: PaymentStatus.PAID, actorRole: Role.ADMIN, verifiedByUserId: 'admin-1' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toEqual({
      event: 'payment.state_transition',
      correlationId: 'corr-test',
      paymentId: 'payment-1',
      orderId: 'order-1',
      from: PaymentStatus.UNDER_REVIEW,
      to: PaymentStatus.PAID,
      actorRole: Role.ADMIN,
      verifiedByUserId: 'admin-1',
    });
  });

  it('J: a rejected transition attempt (terminal state) never logs a transition event', async () => {
    const { service } = buildHarness({ id: 'payment-1', status: PaymentStatus.PAID });
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);

    await expect(
      service.transition({ paymentId: 'payment-1', to: PaymentStatus.REJECTED, actorRole: Role.ADMIN }),
    ).rejects.toThrow(ConflictException);

    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('PaymentStateMachineService — PD-004 pending refund reconciliation', () => {
  it('PAID: the ORDER row is locked before the PAYMENT row (cancellation locks order → payment, so no deadlock), then the entitlement is converted in the same transaction with the verifier as actor', async () => {
    const h = buildHarness({ id: 'payment-1', status: PaymentStatus.UNDER_REVIEW });
    await h.service.transition({ paymentId: 'payment-1', to: PaymentStatus.PAID, actorRole: Role.ADMIN, verifiedByUserId: 'admin-1' });
    expect(h.lockedEntities).toEqual(['Order', 'Payment']);
    expect(h.manualTransferRefundService.convertPendingRefund).toHaveBeenCalledTimes(1);
    const [payment, actor, manager] = (h.manualTransferRefundService.convertPendingRefund.mock.calls as any[])[0];
    expect(payment.status).toBe(PaymentStatus.PAID);
    expect(actor).toBe('admin-1');
    expect(manager).toBe(h.manager);
    expect(h.manualTransferRefundService.voidPendingRefund).not.toHaveBeenCalled();
  });

  it('REJECTED: the entitlement is voided (nothing is paid); no order lock, no conversion', async () => {
    const h = buildHarness({ id: 'payment-1', status: PaymentStatus.UNDER_REVIEW });
    await h.service.transition({ paymentId: 'payment-1', to: PaymentStatus.REJECTED, actorRole: Role.ADMIN, verifiedByUserId: 'admin-1', rejectionReason: 'no money' });
    expect(h.manualTransferRefundService.voidPendingRefund).toHaveBeenCalledTimes(1);
    expect(h.manualTransferRefundService.convertPendingRefund).not.toHaveBeenCalled();
    expect(h.lockedEntities).toEqual(['Payment']);
  });

  it('claim / review transitions never touch the refund entitlement', async () => {
    const h = buildHarness({ id: 'payment-1', status: PaymentStatus.PENDING });
    await h.service.transition({ paymentId: 'payment-1', to: PaymentStatus.CUSTOMER_CLAIMED_TRANSFER, actorRole: Role.CUSTOMER });
    expect(h.manualTransferRefundService.convertPendingRefund).not.toHaveBeenCalled();
    expect(h.manualTransferRefundService.voidPendingRefund).not.toHaveBeenCalled();
  });

  it('a refused transition (already PAID → PAID) never reconciles again', async () => {
    const h = buildHarness({ id: 'payment-1', status: PaymentStatus.PAID });
    await expect(h.service.transition({ paymentId: 'payment-1', to: PaymentStatus.PAID, actorRole: Role.ADMIN })).rejects.toThrow(ConflictException);
    expect(h.manualTransferRefundService.convertPendingRefund).not.toHaveBeenCalled();
  });
});
