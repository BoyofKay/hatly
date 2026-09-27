import Redis from 'ioredis';
import { RedisLifecycle } from './redis-lifecycle';

function buildClient(status: string, overrides: Partial<Record<'quit' | 'disconnect', jest.Mock>> = {}) {
  return {
    status,
    quit: overrides.quit ?? jest.fn(async () => 'OK'),
    disconnect: overrides.disconnect ?? jest.fn(),
  } as unknown as Redis & { quit: jest.Mock; disconnect: jest.Mock };
}

describe('RedisLifecycle', () => {
  it('closes a healthy (ready) connection gracefully with QUIT, without a hard disconnect', async () => {
    const client = buildClient('ready');
    await new RedisLifecycle(client).onApplicationShutdown();
    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('a connection that is not ready is disconnected immediately — QUIT would queue forever behind a dead connection', async () => {
    const client = buildClient('reconnecting');
    await new RedisLifecycle(client).onApplicationShutdown();
    expect(client.quit).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('falls back to a hard disconnect if QUIT itself fails, and never throws out of shutdown', async () => {
    const client = buildClient('ready', { quit: jest.fn(async () => { throw new Error('connection lost'); }) });
    await expect(new RedisLifecycle(client).onApplicationShutdown()).resolves.toBeUndefined();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });
});
