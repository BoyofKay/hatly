import { Global, Module } from '@nestjs/common';
import { RequestContextService } from './request-context.service';
import { RequestContextMiddleware } from './request-context.middleware';

/**
 * `@Global()` so any service anywhere can `@Inject`/constructor-inject
 * `RequestContextService` without every feature module re-importing
 * this one — same convention already established by RedisModule
 * (Group 1) and matching `ConfigModule.forRoot({ isGlobal: true })`.
 * `RequestContextMiddleware` is exported too, purely so AppModule's
 * own `configure()` can resolve it for `.apply(...)`.
 */
@Global()
@Module({
  providers: [RequestContextService, RequestContextMiddleware],
  exports: [RequestContextService, RequestContextMiddleware],
})
export class RequestContextModule {}
