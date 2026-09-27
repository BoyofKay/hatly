import { OrderStatusHistoryService } from './order-status-history.service';
import { OrderStatusEvent } from './entities/order-status-event.entity';

describe('OrderStatusHistoryService', () => {
  it('appends one row on the CALLER\'s manager (same transaction), with actor nulls defaulted', async () => {
    const insert = jest.fn(async () => undefined);
    const manager = { getRepository: jest.fn(() => ({ insert })) } as any;
    await new OrderStatusHistoryService().record(manager, { orderId: 'o1', from: null, to: 'PENDING', actorRole: 'CUSTOMER', actorUserId: 'u1' });
    expect(manager.getRepository).toHaveBeenCalledWith(OrderStatusEvent);
    expect(insert).toHaveBeenCalledWith({ orderId: 'o1', fromStatus: null, toStatus: 'PENDING', actorRole: 'CUSTOMER', actorUserId: 'u1' });

    await new OrderStatusHistoryService().record(manager, { orderId: 'o1', from: 'PENDING', to: 'CONFIRMED' });
    expect(insert).toHaveBeenLastCalledWith({ orderId: 'o1', fromStatus: 'PENDING', toStatus: 'CONFIRMED', actorRole: null, actorUserId: null });
  });
});
