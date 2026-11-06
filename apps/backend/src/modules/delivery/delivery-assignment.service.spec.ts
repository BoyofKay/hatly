import { ConflictException } from '@nestjs/common';
import { DeliveryAssignmentService, OrderNotAssignableException } from './delivery-assignment.service';
import { Driver } from './entities/driver.entity';
import { Delivery } from './entities/delivery.entity';
import { Order } from '../orders/entities/order.entity';

// DeliveryAssignmentService now receives its Redis client via
// constructor injection (Group 1 — Redis reliability hardening) rather
// than constructing one internally, so no `jest.mock('ioredis')`
// module-level mocking is needed here anymore.

/**
 * Driver Push Notifications. Focused on the NEW push-trigger wiring
 * only — not a re-test of the existing locking/candidate-selection
 * logic (untouched by this chunk).
 */
function buildHarness(
  opts: { driver?: any; transitionSucceeds?: boolean; existingDelivery?: any; orderStatus?: string; drivers?: Record<string, any>; fulfillmentType?: string; ackWindowMinutes?: unknown } = {},
) {
  const driver = opts.driver ?? { id: 'driver-1', userId: 'user-1', isAvailable: true, isOnline: true };
  const writes: string[] = [];

  const manager = {
    findOne: async (EntityClass: any, findOpts: any) => {
      if (EntityClass === Order) return { id: findOpts.where.id, status: opts.orderStatus ?? 'READY_FOR_PICKUP', fulfillmentType: opts.fulfillmentType ?? 'DELIVERY' };
      if (EntityClass === Driver) {
        const row = opts.drivers ? opts.drivers[findOpts.where.id] : driver;
        return row ? { ...row } : null;
      }
      if (EntityClass === Delivery) return opts.existingDelivery ? { ...opts.existingDelivery } : null; // deliveries.order_id is UNIQUE
      if (EntityClass?.name === 'BusinessConfig') return opts.ackWindowMinutes !== undefined ? { value: opts.ackWindowMinutes } : null;
      throw new Error('unhandled findOne');
    },
    save: async (entity: any) => {
      writes.push(`save:${entity.driverId !== undefined ? 'delivery' : 'driver'}`);
      return entity;
    },
    create: (_EntityClass: any, data: any) => ({ id: 'delivery-1', ...data }),
    createQueryBuilder: () => {
      const qb: any = { update: () => qb, set: () => qb, where: () => qb, execute: async () => writes.push('resolve-alerts') };
      return qb;
    },
  };
  // A real transaction rolls back on error: model that by discarding the writes of a failed callback.
  const dataSource = {
    transaction: async (cb: any) => {
      const before = writes.length;
      try {
        return await cb(manager);
      } catch (e) {
        writes.splice(before);
        throw e;
      }
    },
  };

  const afterCommit = jest.fn(async () => undefined);
  const orderStateMachine = {
    transitionInTransaction: jest.fn(async (_m: any, params: any) => {
      if (opts.transitionSucceeds === false) {
        throw new ConflictException('transition failed');
      }
      writes.push(`transition:${params.to}`);
      return { order: { id: params.orderId }, afterCommit };
    }),
  };

  const pushNotificationService = {
    sendOrderAssignedNotification: jest.fn(async () => undefined),
  };

  const service = new DeliveryAssignmentService(
    {} as any,
    {} as any,
    orderStateMachine as any,
    dataSource as any,
    pushNotificationService as any,
    {} as any, // injected Redis client — bypassed via acquireLock/releaseLock overrides below
    { getCorrelationId: () => 'corr-test' } as any,
  );
  // Bypass the real Redis lock for this focused test — only the
  // push-trigger wiring is under test here.
  (service as any).acquireLock = jest.fn(async () => true);
  (service as any).releaseLock = jest.fn(async () => undefined);

  return { service, pushNotificationService, orderStateMachine, writes, afterCommit };
}

describe('DeliveryAssignmentService — Driver Push Notifications', () => {
  it('sends the assignment push AFTER a successful assignment, using the ASSIGNED DRIVER\u2019s userId, the orderId, and the created delivery\u2019s id', async () => {
    const { service, pushNotificationService } = buildHarness();
    await service.assignDriver({ orderId: 'order-1', candidateDriverIds: ['driver-1'] });
    expect(pushNotificationService.sendOrderAssignedNotification).toHaveBeenCalledWith('user-1', 'order-1', 'delivery-1');
  });

  it('CRITICAL: does NOT send a push if the order-state-machine transition fails', async () => {
    const { service, pushNotificationService } = buildHarness({ transitionSucceeds: false });
    await expect(service.assignDriver({ orderId: 'order-2', candidateDriverIds: ['driver-1'] })).rejects.toThrow();
    expect(pushNotificationService.sendOrderAssignedNotification).not.toHaveBeenCalled();
  });

  it('CRITICAL: does NOT send a push if no candidate driver could be assigned (driver unavailable)', async () => {
    const { service, pushNotificationService } = buildHarness({
      driver: { id: 'driver-1', userId: 'user-1', isAvailable: false, isOnline: true },
    });
    await expect(service.assignDriver({ orderId: 'order-3', candidateDriverIds: ['driver-1'] })).rejects.toThrow(
      ConflictException,
    );
    expect(pushNotificationService.sendOrderAssignedNotification).not.toHaveBeenCalled();
  });

  it('a successful assignment still returns the Delivery regardless of push outcome (PushNotificationService itself never throws, confirmed at its own layer)', async () => {
    const { service } = buildHarness();
    const delivery = await service.assignDriver({ orderId: 'order-4', candidateDriverIds: ['driver-1'] });
    expect(delivery).toBeTruthy();
  });
});

describe('DeliveryAssignmentService — structured business-event logging (Group 4)', () => {
  it('B: a successful assignment logs dispatch.driver_assigned with orderId/deliveryId/driverId, post-commit', async () => {
    const { service } = buildHarness();
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);

    await service.assignDriver({ orderId: 'order-5', candidateDriverIds: ['driver-1'] });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toEqual({
      event: 'dispatch.driver_assigned',
      correlationId: 'corr-test',
      orderId: 'order-5',
      deliveryId: 'delivery-1',
      driverId: 'driver-1',
    });
  });

  it('C: exhausting every candidate logs dispatch.assignment_failed at WARN before the ConflictException is thrown', async () => {
    const { service } = buildHarness({ driver: { id: 'driver-1', userId: 'user-1', isAvailable: false, isOnline: true } });
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    await expect(service.assignDriver({ orderId: 'order-6', candidateDriverIds: ['driver-1'] })).rejects.toThrow(ConflictException);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged).toEqual({ event: 'dispatch.assignment_failed', correlationId: 'corr-test', orderId: 'order-6', candidateCount: 1 });
  });
});

describe('DeliveryAssignmentService — handing an order to a new driver (Group 8 regression)', () => {
  it('reuses the order\'s existing delivery row instead of inserting a second one (deliveries.order_id is UNIQUE)', async () => {
    const created: any[] = [];
    const saved: any[] = [];
    const { service } = buildHarness({ existingDelivery: { id: 'delivery-9', orderId: 'order-1', driverId: 'old-driver', pickedUpAt: null, reassignmentCount: 2 } });
    // observe what the transaction persists
    const manager = (service as any).dataSource;
    const original = manager.transaction;
    manager.transaction = async (cb: any) =>
      original.call(manager, async (m: any) =>
        cb({
          ...m,
          create: (...args: any[]) => {
            const row = m.create(...args);
            created.push(row);
            return row;
          },
          save: async (entity: any) => {
            saved.push(entity);
            return m.save(entity);
          },
        }),
      );

    const delivery = await service.assignDriver({ orderId: 'order-1', candidateDriverIds: ['driver-1'] });

    expect(created).toEqual([]); // no INSERT path
    expect(delivery).toMatchObject({ id: 'delivery-9', orderId: 'order-1', driverId: 'driver-1', reassignmentCount: 2, pickedUpAt: null, deliveredAt: null });
    expect(delivery.assignedAt).toBeInstanceOf(Date);
    expect(saved.filter((e) => e.id === 'delivery-9')).toHaveLength(1);
  });
});

/**
 * Reliability & Adversarial Testing milestone. The lock's REAL `acquireLock`/`releaseLock`
 * implementation (bypassed by `buildHarness` above for the assignment-logic tests), exercised
 * directly against an in-memory Redis simulation with genuine NX/CAS semantics — the exact pattern
 * `AutomaticDispatchService`'s own sweep-lock tests already use for the identical class of bug.
 */
function buildLockOnlyHarness() {
  let lockValue: string | null = null;
  const redis = {
    set: jest.fn(async (_key: string, value: string, _px: string, _ttl: number, _nx: string) => {
      if (lockValue !== null) return null;
      lockValue = value;
      return 'OK';
    }),
    eval: jest.fn(async (_script: string, _numKeys: number, _key: string, token: string) => {
      if (lockValue === token) {
        lockValue = null;
        return 1;
      }
      return 0;
    }),
  };
  const service = new DeliveryAssignmentService({} as any, {} as any, {} as any, {} as any, {} as any, redis as any, {} as any);
  return { service, getLockValue: () => lockValue, setLockValueForTest: (v: string | null) => (lockValue = v) };
}

describe('DeliveryAssignmentService — Reliability & Adversarial Testing milestone: driver-lock ownership-token CAS release (regression)', () => {
  it('acquireLock returns a fresh, unique token each call; a second acquire attempt while the lock is held fails', async () => {
    const { service } = buildLockOnlyHarness();
    const token1 = await (service as any).acquireLock('driver-1');
    expect(typeof token1).toBe('string');
    const token2 = await (service as any).acquireLock('driver-1');
    expect(token2).toBeNull();
  });

  it('CRITICAL (the bug this milestone fixes): releasing with a STALE/foreign token — because the TTL already expired and a DIFFERENT assignment attempt re-acquired the lock under a NEW token — is correctly a no-op, never deletes the other attempt\'s active lock', async () => {
    const { service, getLockValue, setLockValueForTest } = buildLockOnlyHarness();
    const myToken = await (service as any).acquireLock('driver-1');
    expect(typeof myToken).toBe('string');

    // Simulates: this lock's TTL expired while `assignDriver` was still mid-flight, and a DIFFERENT
    // concurrent attempt for the SAME driver legitimately re-acquired it under a new token.
    setLockValueForTest('other-attempts-token');

    await (service as any).releaseLock('driver-1', myToken);
    expect(getLockValue()).toBe('other-attempts-token'); // untouched — the old blind DEL would have cleared this

    await (service as any).releaseLock('driver-1', 'other-attempts-token');
    expect(getLockValue()).toBeNull(); // the actual owner's release still works correctly
  });

  it('the lock is re-acquirable by a new attempt once correctly released', async () => {
    const { service } = buildLockOnlyHarness();
    const token = await (service as any).acquireLock('driver-1');
    await (service as any).releaseLock('driver-1', token);
    const token2 = await (service as any).acquireLock('driver-1');
    expect(typeof token2).toBe('string');
  });
});

describe('DeliveryAssignmentService — atomic assignment (Control Tower milestone)', () => {
  const code = (e: any) => e?.getResponse?.()?.details?.code;

  it('assigns in ONE transaction: driver locked out, delivery written, open alerts resolved, READY→ASSIGNED — push only after commit', async () => {
    const h = buildHarness();
    await h.service.assignDriver({ orderId: 'order-1', candidateDriverIds: ['driver-1'] });
    expect(h.writes).toEqual(['save:driver', 'save:delivery', 'resolve-alerts', 'transition:ASSIGNED_TO_DRIVER']);
    expect(h.afterCommit).toHaveBeenCalledTimes(1);
    expect(h.pushNotificationService.sendOrderAssignedNotification).toHaveBeenCalledTimes(1);
  });

  it.each(['PENDING', 'PREPARING', 'ASSIGNED_TO_DRIVER', 'PICKED_UP', 'CANCELLED', 'DELIVERED'])(
    'an order that is %s is refused BEFORE anything is written (no driver locked out, no delivery overwritten, no push)',
    async (orderStatus) => {
      const h = buildHarness({ orderStatus, existingDelivery: { id: 'delivery-1', orderId: 'order-1', driverId: 'current-driver' } });
      const error = await h.service.assignDriver({ orderId: 'order-1', candidateDriverIds: ['driver-1'] }).catch((e) => e);
      expect(error).toBeInstanceOf(OrderNotAssignableException);
      expect(code(error)).toBe('ORDER_NOT_ASSIGNABLE');
      expect(h.writes).toEqual([]);
      expect(h.pushNotificationService.sendOrderAssignedNotification).not.toHaveBeenCalled();
    },
  );

  it('a PICKUP order (collected by the customer, no address) is never assigned to a driver — nothing written', async () => {
    const h = buildHarness({ fulfillmentType: 'PICKUP' });
    const error = await h.service.assignDriver({ orderId: 'order-1', candidateDriverIds: ['driver-1'] }).catch((e) => e);
    expect(error).toBeInstanceOf(OrderNotAssignableException);
    expect(h.writes).toEqual([]);
  });

  it('a failing transition rolls the whole assignment back (nothing half-applied)', async () => {
    const h = buildHarness({ transitionSucceeds: false });
    await expect(h.service.assignDriver({ orderId: 'order-1', candidateDriverIds: ['driver-1'] })).rejects.toThrow();
    expect(h.writes).toEqual([]);
  });

  it('exhausting every candidate is a 409 with a machine-readable code', async () => {
    const h = buildHarness({ driver: { id: 'driver-1', userId: 'u', isAvailable: false, isOnline: true } });
    const error = await h.service.assignDriver({ orderId: 'order-1', candidateDriverIds: ['driver-1'] }).catch((e) => e);
    expect(code(error)).toBe('NO_AVAILABLE_DRIVER');
  });

  describe('reassignDriver', () => {
    const drivers = {
      old: { id: 'old', userId: 'u-old', isAvailable: false, isOnline: true },
      next: { id: 'next', userId: 'u-next', isAvailable: true, isOnline: true },
      offline: { id: 'offline', userId: 'u-off', isAvailable: true, isOnline: false },
    };
    const assigned = () => ({ orderStatus: 'ASSIGNED_TO_DRIVER', drivers, existingDelivery: { id: 'delivery-1', orderId: 'order-1', driverId: 'old', reassignmentCount: 2 } });

    it('releases and re-assigns in ONE transaction; counter +1; the new driver is notified after commit', async () => {
      const h = buildHarness(assigned());
      const delivery = await h.service.reassignDriver({ orderId: 'order-1', newDriverId: 'next', expectedCurrentDriverId: 'old' });
      expect(h.writes).toEqual(['transition:READY_FOR_PICKUP', 'save:driver', 'save:delivery', 'resolve-alerts', 'transition:ASSIGNED_TO_DRIVER']);
      expect(delivery).toMatchObject({ driverId: 'next', reassignmentCount: 3 });
      expect(h.afterCommit).toHaveBeenCalledTimes(2);
      expect(h.pushNotificationService.sendOrderAssignedNotification).toHaveBeenCalledWith('u-next', 'order-1', 'delivery-1');
    });

    it.each([
      ['the assignment changed since the admin loaded it', { newDriverId: 'next', expectedCurrentDriverId: 'someone-else' }, 'ASSIGNMENT_CHANGED'],
      ['the new driver is the current driver', { newDriverId: 'old' }, 'DRIVER_ALREADY_ASSIGNED'],
      ['the new driver is offline', { newDriverId: 'offline' }, 'DRIVER_UNAVAILABLE'],
      ['the new driver does not exist', { newDriverId: 'ghost' }, 'DRIVER_UNAVAILABLE'],
    ])('refused when %s — and NOTHING changes (the order stays with its driver)', async (_, params, expected) => {
      const h = buildHarness(assigned());
      const error = await h.service.reassignDriver({ orderId: 'order-1', ...params } as any).catch((e) => e);
      expect(code(error)).toBe(expected);
      expect(h.writes).toEqual([]);
      expect(h.pushNotificationService.sendOrderAssignedNotification).not.toHaveBeenCalled();
    });

    it.each(['READY_FOR_PICKUP', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'FAILED_DELIVERY', 'CANCELLED'])(
      'an order that is %s cannot be reassigned (the carrying driver is never marked available)',
      async (orderStatus) => {
        const h = buildHarness({ ...assigned(), orderStatus });
        const error = await h.service.reassignDriver({ orderId: 'order-1', newDriverId: 'next' }).catch((e) => e);
        expect(error).toBeInstanceOf(OrderNotAssignableException);
        expect(code(error)).toBe('ORDER_NOT_REASSIGNABLE');
        expect(h.writes).toEqual([]);
      },
    );

    it('a busy driver lock (another assignment mid-flight for the new driver) is a clear 409, nothing changes', async () => {
      const h = buildHarness(assigned());
      (h.service as any).acquireLock = jest.fn(async () => null);
      const error = await h.service.reassignDriver({ orderId: 'order-1', newDriverId: 'next' }).catch((e) => e);
      expect(code(error)).toBe('DRIVER_UNAVAILABLE');
      expect(h.writes).toEqual([]);
    });
  });
});

describe('DeliveryAssignmentService — R16 acknowledgement deadline', () => {
  const savedDelivery = (writesHarness: any) => writesHarness;
  it.each([
    [undefined, 5],
    [10, 10],
    [1, 1],
    [30, 30],
    [0, 5],
    [31, 5],
    ['7', 5],
  ])('window %p minutes stored -> acknowledge-by is %p minutes after assignment (default 5, bounds 1-30)', async (stored, expectedMinutes) => {
    const { service } = buildHarness({ ackWindowMinutes: stored });
    const before = Date.now();
    const delivery: any = await service.assignDriver({ orderId: 'order-1', candidateDriverIds: ['driver-1'] });
    const deltaMin = (delivery.acceptDeadlineAt.getTime() - before) / 60_000;
    expect(deltaMin).toBeGreaterThanOrEqual(expectedMinutes - 0.05);
    expect(deltaMin).toBeLessThanOrEqual(expectedMinutes + 0.05);
    expect(delivery.acknowledgedAt).toBeNull();
    savedDelivery(delivery);
  });

  it('a reassignment (existing delivery row) resets the acknowledgement of the previous driver', async () => {
    const { service } = buildHarness({ existingDelivery: { id: 'delivery-1', orderId: 'order-1', driverId: 'old', acknowledgedAt: new Date() } });
    const delivery: any = await service.assignDriver({ orderId: 'order-1', candidateDriverIds: ['driver-1'] });
    expect(delivery.driverId).toBe('driver-1');
    expect(delivery.acknowledgedAt).toBeNull();
  });
});
