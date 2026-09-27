import { Logger } from '@nestjs/common';

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    return {
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        handlers[event] = handler;
      }),
      // Test-only escape hatch to fire a registered handler directly —
      // simulates what a real ioredis client does internally when a
      // connection error occurs.
      __emit: (event: string, ...args: any[]) => handlers[event]?.(...args),
    };
  }),
}));

import { createRedisClient } from './redis-client.factory';

describe('createRedisClient', () => {
  it('registers an error listener so a Redis error is logged instead of becoming an unhandled EventEmitter error', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const client = createRedisClient('redis://user:pass@localhost:6379') as any;

    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));

    // Simulating the real ioredis 'error' event: this must never throw.
    expect(() => client.__emit('error', new Error('ECONNREFUSED 127.0.0.1:6379'))).not.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
    // Never logs the connection string/credentials — only the error message.
    expect(errorSpy.mock.calls[0][0]).not.toContain('user:pass');

    errorSpy.mockRestore();
  });

  it('bounds per-command retries so a Redis outage fails requests fast instead of hanging them for ~10s', () => {
    const Redis = jest.requireMock('ioredis').default as jest.Mock;
    createRedisClient('redis://localhost:6379');
    expect(Redis).toHaveBeenLastCalledWith('redis://localhost:6379', { maxRetriesPerRequest: 3 });
  });
});
