import { ConflictException } from '@nestjs/common';
import { OrderPaymentGateService } from './order-payment-gate.service';
import { PaymentStatus } from '../payments/payment-status.enum';

const manager = (payment: any) => ({ getRepository: () => ({ findOne: jest.fn(async () => payment) }) }) as any;
const gate = new OrderPaymentGateService();

describe('OrderPaymentGateService — payment gating', () => {
  it.each(['COD', 'PAY_AT_DELIVERY', 'WALLET'] as const)('%s never blocks fulfilment (and never even looks for a payment row)', async (method) => {
    const m = { getRepository: jest.fn() } as any;
    await expect(gate.assertFulfilmentMayProceed(m, { id: 'o1', paymentMethod: method })).resolves.toBeUndefined();
    expect(m.getRepository).not.toHaveBeenCalled();
  });

  it('MANUAL_TRANSFER passes only once the payment is PAID', async () => {
    await expect(gate.assertFulfilmentMayProceed(manager({ status: PaymentStatus.PAID }), { id: 'o1', paymentMethod: 'MANUAL_TRANSFER' })).resolves.toBeUndefined();
  });

  it.each([PaymentStatus.PENDING, PaymentStatus.CUSTOMER_CLAIMED_TRANSFER, PaymentStatus.UNDER_REVIEW, PaymentStatus.REJECTED])('MANUAL_TRANSFER blocks while the payment is %s, saying which state', async (status) => {
    const error = await gate.assertFulfilmentMayProceed(manager({ status }), { id: 'o1', paymentMethod: 'MANUAL_TRANSFER' }).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().details).toEqual({ code: 'PAYMENT_NOT_APPROVED', paymentStatus: status });
  });

  it('MANUAL_TRANSFER with no payment row at all also blocks (fail closed)', async () => {
    await expect(gate.assertFulfilmentMayProceed(manager(null), { id: 'o1', paymentMethod: 'MANUAL_TRANSFER' })).rejects.toBeInstanceOf(ConflictException);
  });
});
