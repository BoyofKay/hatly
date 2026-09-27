import { Logger } from '@nestjs/common';
import { logBusinessEvent } from './log-business-event';
import { BusinessEvent } from './business-events';

function buildLogger() {
  return {
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

describe('logBusinessEvent', () => {
  it('emits a single-line JSON payload containing the event, correlationId, and every field', () => {
    const logger = buildLogger();

    logBusinessEvent(logger, 'log', BusinessEvent.ORDER_CREATED, () => 'corr-1', {
      orderId: 'order-1',
      totalMinor: 5000,
    });

    expect(logger.log).toHaveBeenCalledTimes(1);
    const [line] = (logger.log as jest.Mock).mock.calls[0];
    expect(JSON.parse(line)).toEqual({
      event: 'order.created',
      correlationId: 'corr-1',
      orderId: 'order-1',
      totalMinor: 5000,
    });
  });

  it('routes to the matching Logger method for each level', () => {
    const logger = buildLogger();

    logBusinessEvent(logger, 'debug', BusinessEvent.ORDER_CREATED, () => 'c', {});
    logBusinessEvent(logger, 'log', BusinessEvent.ORDER_CREATED, () => 'c', {});
    logBusinessEvent(logger, 'warn', BusinessEvent.ORDER_CREATED, () => 'c', {});
    logBusinessEvent(logger, 'error', BusinessEvent.ORDER_CREATED, () => 'c', {});

    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('CRITICAL: never throws, even when the underlying Logger call throws', () => {
    const logger = { log: jest.fn(() => { throw new Error('logger transport is down'); }) } as unknown as Logger;

    expect(() => logBusinessEvent(logger, 'log', BusinessEvent.ORDER_CREATED, () => 'corr', { orderId: 'x' })).not.toThrow();
  });

  it('CRITICAL: never throws when a field cannot be serialized (e.g. a BigInt)', () => {
    const logger = buildLogger();

    expect(() =>
      logBusinessEvent(logger, 'log', BusinessEvent.ORDER_CREATED, () => 'corr', {
        // @ts-expect-error deliberately passing an unsupported value to prove the swallow-path
        badField: 10n,
      }),
    ).not.toThrow();
    // Nothing was logged either — a malformed payload is dropped, never partially/incorrectly emitted.
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('CRITICAL (requirement 19): never throws when the correlation-id getter itself throws — deferred inside the same try/catch, not resolved by the caller beforehand', () => {
    const logger = buildLogger();
    const throwingGetter = () => {
      throw new Error('request context unexpectedly unavailable');
    };

    expect(() => logBusinessEvent(logger, 'log', BusinessEvent.ORDER_CREATED, throwingGetter, { orderId: 'x' })).not.toThrow();
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('omits undefined fields from the emitted JSON (keeps log lines small and consistent)', () => {
    const logger = buildLogger();

    logBusinessEvent(logger, 'log', BusinessEvent.ORDER_CREATED, () => 'corr', {
      orderId: 'order-1',
      actorUserId: undefined,
    });

    const [line] = (logger.log as jest.Mock).mock.calls[0];
    expect(JSON.parse(line)).toEqual({ event: 'order.created', correlationId: 'corr', orderId: 'order-1' });
  });
});
