import { ConflictException, NotFoundException } from '@nestjs/common';
import { ManualTransferService } from './manual-transfer.service';
import { PaymentStatus } from './payment-status.enum';
import { Role } from '../../common/enums/role.enum';

function buildHarness(payment: any) {
  const stored = { ...payment };
  const paymentsRepository = {
    findOne: jest.fn(async () => ({ ...stored, order: { customerId: stored.orderCustomerId } })),
  };
  const paymentStateMachine = {
    transition: jest.fn(async (params: any) => {
      stored.status = params.to;
      return { ...stored };
    }),
  };
  const businessConfigService = {
    getManualTransferDestination: jest.fn(async () => ({
      label: 'Vodafone Cash',
      phoneOrAccountNumber: '01000000000',
    })),
    getCustomerServiceWhatsappNumber: jest.fn(async () => '01000000001'),
  };
  const service = new ManualTransferService(
    paymentsRepository as any,
    paymentStateMachine as any,
    businessConfigService as any,
  );
  return { service, stored, paymentStateMachine };
}

describe('ManualTransferService', () => {
  it('getConfig returns both configured values', async () => {
    const { service } = buildHarness({ id: 'payment-1', status: PaymentStatus.PENDING, orderCustomerId: 'user-1' });
    const config = await service.getConfig();
    expect(config.destination.phoneOrAccountNumber).toBe('01000000000');
    expect(config.whatsappNumber).toBe('01000000001');
  });

  it('claimTransfer performs both confirmed transitions (PENDING -> CLAIMED -> UNDER_REVIEW) in one call', async () => {
    const { service, paymentStateMachine } = buildHarness({
      id: 'payment-1',
      status: PaymentStatus.PENDING,
      orderCustomerId: 'user-1',
    });

    const result = await service.claimTransfer('user-1', 'order-1');

    expect(paymentStateMachine.transition).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ to: PaymentStatus.CUSTOMER_CLAIMED_TRANSFER, actorRole: Role.CUSTOMER }),
    );
    expect(paymentStateMachine.transition).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ to: PaymentStatus.UNDER_REVIEW, actorRole: Role.ADMIN }),
    );
    expect(result.status).toBe(PaymentStatus.UNDER_REVIEW);
  });

  it('is idempotent — a repeat claim on an already-claimed payment returns the current state without transitioning again', async () => {
    const { service, paymentStateMachine } = buildHarness({
      id: 'payment-1',
      status: PaymentStatus.UNDER_REVIEW,
      orderCustomerId: 'user-1',
    });

    const result = await service.claimTransfer('user-1', 'order-1');

    expect(paymentStateMachine.transition).not.toHaveBeenCalled();
    expect(result.status).toBe(PaymentStatus.UNDER_REVIEW);
  });

  it("rejects a claim from a user who doesn't own the order — never leaks whether the payment exists", async () => {
    const { service } = buildHarness({ id: 'payment-1', status: PaymentStatus.PENDING, orderCustomerId: 'user-2' });

    await expect(service.claimTransfer('user-1', 'order-1')).rejects.toThrow(NotFoundException);
  });

  it('Reliability & Adversarial Testing milestone (regression): a concurrent caller that already advanced this payment past the expected state is a clean, idempotent success — never a raw ConflictException', async () => {
    const { service, stored, paymentStateMachine } = buildHarness({
      id: 'payment-1',
      status: PaymentStatus.PENDING,
      orderCustomerId: 'user-1',
    });
    // Simulates the real, reproduced race: by the time THIS call's own transition() runs, a
    // concurrent caller already committed CUSTOMER_CLAIMED_TRANSFER → UNDER_REVIEW underneath it.
    paymentStateMachine.transition.mockImplementationOnce(async () => {
      stored.status = PaymentStatus.UNDER_REVIEW; // the concurrent winner's own commit
      throw new ConflictException('Cannot transition payment from UNDER_REVIEW to CUSTOMER_CLAIMED_TRANSFER.');
    });

    const result = await service.claimTransfer('user-1', 'order-1');

    expect(result.status).toBe(PaymentStatus.UNDER_REVIEW); // the current, authoritative row — not an error
    expect(paymentStateMachine.transition).toHaveBeenCalledTimes(1); // never attempted the second step after losing the race
  });
});
