import { ServiceUnavailableException } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('is marked @Public() at the class level, so the global JwtAuthGuard never blocks it', () => {
    // This is exactly the metadata JwtAuthGuard.canActivate reads via
    // Reflector.getAllAndOverride([handler, class]) — verifying it here
    // directly proves the guard's own bypass condition is satisfied,
    // without needing a full Nest bootstrap.
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, HealthController)).toBe(true);
  });

  describe('liveness', () => {
    it('responds successfully without calling HealthService (no dependency touched)', () => {
      const healthService = { checkReadiness: jest.fn() };
      const controller = new HealthController(healthService as any);

      const result = controller.liveness();

      expect(result).toEqual({ data: { status: 'ok' } });
      expect(healthService.checkReadiness).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('returns the check breakdown wrapped in the standard { data } envelope when all dependencies are up', async () => {
      const readyResult = { status: 'ok' as const, checks: { database: 'up' as const, redis: 'up' as const } };
      const healthService = { checkReadiness: jest.fn(async () => readyResult) };
      const controller = new HealthController(healthService as any);

      const result = await controller.readiness();

      expect(result).toEqual({ data: readyResult });
    });

    it('CRITICAL: throws ServiceUnavailableException (503) when degraded — never returns 200 for a not-ready instance', async () => {
      const degradedResult = {
        status: 'degraded' as const,
        checks: { database: 'down' as const, redis: 'up' as const },
      };
      const healthService = { checkReadiness: jest.fn(async () => degradedResult) };
      const controller = new HealthController(healthService as any);

      await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('the thrown exception carries the check breakdown but no raw error content, credentials, or connection strings', async () => {
      const degradedResult = {
        status: 'degraded' as const,
        checks: { database: 'down' as const, redis: 'up' as const },
      };
      const healthService = { checkReadiness: jest.fn(async () => degradedResult) };
      const controller = new HealthController(healthService as any);

      let caught: ServiceUnavailableException | undefined;
      try {
        await controller.readiness();
      } catch (err) {
        caught = err as ServiceUnavailableException;
      }

      expect(caught).toBeInstanceOf(ServiceUnavailableException);
      const body = caught!.getResponse() as Record<string, unknown>;
      expect(body.details).toEqual(degradedResult);
      const serialized = JSON.stringify(body);
      expect(serialized).not.toMatch(/redis:\/\//);
      expect(serialized).not.toMatch(/postgres:\/\//);
    });
  });
});
