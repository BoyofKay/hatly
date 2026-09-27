import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminManualTransferService } from './admin-manual-transfer.service';
import { PaymentStatus } from './payment-status.enum';

function buildHarness(payment: any | null) {
  const paymentsRepository = {
    findOne: jest.fn(async () => (payment ? { ...payment } : null)),
    find: jest.fn(async () => (payment ? [{ ...payment }] : [])),
  };
  const paymentStateMachine = { transition: jest.fn(async (params: any) => ({ ...payment, status: params.to })) };
  const service = new AdminManualTransferService(paymentsRepository as any, paymentStateMachine as any);
  return { service, paymentStateMachine };
}

describe('AdminManualTransferService', () => {
  it('lists only UNDER_REVIEW payments', async () => {
    const { service } = buildHarness({ id: 'payment-1', status: PaymentStatus.UNDER_REVIEW });
    const list = await service.listUnderReview();
    expect(list).toHaveLength(1);
  });

  it('approve() transitions an UNDER_REVIEW payment to PAID with the acting admin recorded', async () => {
    const { service, paymentStateMachine } = buildHarness({ id: 'payment-1', status: PaymentStatus.UNDER_REVIEW });

    await service.approve('payment-1', 'admin-1');

    expect(paymentStateMachine.transition).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'payment-1', to: PaymentStatus.PAID, verifiedByUserId: 'admin-1' }),
    );
  });

  it('reject() transitions an UNDER_REVIEW payment to REJECTED with a reason', async () => {
    const { service, paymentStateMachine } = buildHarness({ id: 'payment-1', status: PaymentStatus.UNDER_REVIEW });

    await service.reject('payment-1', 'admin-1', 'No matching transfer found');

    expect(paymentStateMachine.transition).toHaveBeenCalledWith(
      expect.objectContaining({ to: PaymentStatus.REJECTED, rejectionReason: 'No matching transfer found' }),
    );
  });

  it('CONFIRMED RULE: rejects approve() on an already-terminal payment, never silently overwriting', async () => {
    const { service, paymentStateMachine } = buildHarness({ id: 'payment-1', status: PaymentStatus.PAID });

    await expect(service.approve('payment-1', 'admin-1')).rejects.toThrow(ConflictException);
    expect(paymentStateMachine.transition).not.toHaveBeenCalled();
  });

  it('CONFIRMED RULE: rejects reject() on an already-terminal payment', async () => {
    const { service, paymentStateMachine } = buildHarness({ id: 'payment-1', status: PaymentStatus.REJECTED });

    await expect(service.reject('payment-1', 'admin-1')).rejects.toThrow(ConflictException);
    expect(paymentStateMachine.transition).not.toHaveBeenCalled();
  });

  it('throws NotFoundException for a non-existent payment', async () => {
    const { service } = buildHarness(null);
    await expect(service.approve('missing', 'admin-1')).rejects.toThrow(NotFoundException);
  });
});
