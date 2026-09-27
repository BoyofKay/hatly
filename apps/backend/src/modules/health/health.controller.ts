import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';

/**
 * Public, unauthenticated endpoints for infrastructure (load balancers,
 * orchestrators, uptime monitors) — @Public()'s own doc comment already
 * names "health checks" as an intended use case. Applied once at the
 * class level since every route here is meant to be public.
 *
 * Deliberately answers only "is the process alive?" / "can this
 * instance serve normal requests right now?" — never where the
 * database/Redis live, what credentials are used, or any internal
 * exception detail. See HealthService's own comment for how dependency
 * results are sanitized before they ever reach this controller.
 */
@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Liveness: "is the process itself alive and able to respond?" Never
   * touches Postgres, Redis, or any other external dependency — a
   * dependency outage must never make this report unhealthy, since an
   * orchestrator restarting/killing the process over a Redis blip would
   * make the outage worse, not better.
   */
  @Get()
  liveness(): { data: { status: 'ok' } } {
    return { data: { status: 'ok' } };
  }

  /**
   * Readiness: "can this instance currently serve normal production
   * requests?" Checks Postgres + the shared Redis client. Throws (503)
   * rather than returning 200 with a degraded flag, so infrastructure
   * that keys off HTTP status alone still routes around this instance
   * correctly. The exception body reuses this API's existing
   * `{ error: { code, message, details } }` envelope (see
   * HttpExceptionFilter) — `details` carries only the already-sanitized
   * up/down breakdown, never a raw error.
   */
  @Get('ready')
  async readiness(): Promise<{ data: Awaited<ReturnType<HealthService['checkReadiness']>> }> {
    const result = await this.healthService.checkReadiness();
    if (result.status !== 'ok') {
      throw new ServiceUnavailableException({ message: 'Service not ready.', details: result });
    }
    return { data: result };
  }
}
