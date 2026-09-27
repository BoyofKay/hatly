import { ConflictException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Order } from './entities/order.entity';
import { Payment } from '../payments/entities/payment.entity';
import { PaymentStatus } from '../payments/payment-status.enum';

/**
 * Payment gating, enforced in the backend state machines (never only in the app):
 *
 *   COD               fulfilment proceeds — cash is collected on delivery
 *   PAY_AT_DELIVERY   fulfilment proceeds — the electronic payment is made when the driver arrives
 *   WALLET            the wallet covers the whole order, already debited — fulfilment proceeds
 *   MANUAL_TRANSFER   an ELECTRONIC PREPAYMENT: the order may not enter PREPARING (order or vendor segment) nor be dispatched
 *                     until an admin has verified the payment as PAID. (Vendors may still accept/confirm.)
 *
 * A PARTIAL wallet payment (PD-001, amended) keeps whichever method pays the remainder — including MANUAL_TRANSFER: the wallet
 * part needs no approval, but the Payment row (holding only the remainder) still gates PREPARING/dispatch until it is PAID.
 */
export function paymentBlocksFulfilment(paymentMethod: string, payment: Pick<Payment, 'status'> | null): boolean {
  if (paymentMethod !== 'MANUAL_TRANSFER') return false;
  return !payment || payment.status !== PaymentStatus.PAID;
}

@Injectable()
export class OrderPaymentGateService {
  async assertFulfilmentMayProceed(manager: EntityManager, order: Pick<Order, 'id' | 'paymentMethod'>): Promise<void> {
    if (order.paymentMethod !== 'MANUAL_TRANSFER') return;

    const payment = await manager.getRepository(Payment).findOne({ where: { orderId: order.id } });
    if (paymentBlocksFulfilment(order.paymentMethod, payment)) {
      throw new ConflictException({
        message: 'This order is waiting for its payment to be approved before it can be prepared or dispatched.',
        details: { code: 'PAYMENT_NOT_APPROVED', paymentStatus: payment?.status ?? null },
      });
    }
  }
}
