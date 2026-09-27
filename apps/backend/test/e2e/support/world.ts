import * as http from 'http';
import { LoggerService } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import * as request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/app.setup';
import { PUSH_NOTIFICATION_PROVIDER, PushNotificationProvider } from '../../../src/modules/notifications/push-provider.interface';
import { boundary } from './external-boundary';
import { E2E_REDIS_URL } from './config';
import { resetE2eInfrastructure } from './db';

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

export interface ApiOptions {
  token?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
}

export interface CapturedLog { level: 'log' | 'error' | 'warn' | 'debug' | 'verbose'; message: string; context?: string }

export interface World {
  /** Every Nest log line the running application emitted (levels log/warn/error), in order. */
  logs: CapturedLog[];
  app: NestExpressApplication;
  baseUrl: string;
  ds: DataSource;
  redis: Redis;
  /** Real HTTP call over a real socket to the real, fully-wired application. */
  api(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, options?: ApiOptions): Promise<ApiResponse>;
  unhandledServerErrors(): string[];
  close(): Promise<void>;
}

/**
 * The E2E push double lives at the FCM boundary only (firebase-admin is an SDK, not fetch).
 * It records exactly what the real PushNotificationService decided to send.
 */
const capturingPush: PushNotificationProvider = {
  async sendToTokens(params) {
    boundary.push.push({ tokens: params.tokens, title: params.title, body: params.body, data: params.data });
    if (boundary.pushMode === 'throw') throw new Error('FCM exploded');
    if (boundary.pushMode === 'fail') return { success: false, invalidTokens: [] };
    if (boundary.pushMode === 'invalid') return { success: false, invalidTokens: [...params.tokens] };
    return { success: true, invalidTokens: [] };
  },
};

/**
 * Boots the REAL AppModule (real TypeORM/PostgreSQL, real Redis, real global guards, filter,
 * interceptor, middleware, ValidationPipe via the production `configureApp`) on an ephemeral TCP
 * port. The database and Redis db are reset first so each spec file starts from the migrated,
 * seeded schema with fresh in-memory throttler counters (a new app instance).
 */
export interface BootOptions {
  resetInfrastructure?: boolean;
  /**
   * 'real' (rate-limit specs): the production in-memory throttler, exactly as deployed.
   * 'relaxed' (default, every other spec): the SAME ThrottlerGuard and the same per-route limits are
   * evaluated, but the storage never reports a hit count — otherwise the 5-per-minute OTP/register
   * limits would 429 the actor factories long before a journey is under test. Rate limiting itself is
   * proven separately, against the real storage, in 80-rate-limiting.e2e-spec.ts.
   */
  throttling?: 'real' | 'relaxed';
}

const relaxedThrottlerStorage: ThrottlerStorage = {
  async increment(_key, ttl) {
    return { totalHits: 1, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
  },
};

export async function bootWorld(options: BootOptions = {}): Promise<World> {
  const logs: CapturedLog[] = [];
  const stringify = (m: unknown) => (typeof m === 'string' ? m : JSON.stringify(m));
  const capturingLogger: LoggerService = {
    log: (m, ctx) => void logs.push({ level: 'log', message: stringify(m), context: ctx as string }),
    warn: (m, ctx) => void logs.push({ level: 'warn', message: stringify(m), context: ctx as string }),
    error: (m, ...rest) => void logs.push({ level: 'error', message: stringify(m), context: rest[rest.length - 1] as string }),
    debug: () => undefined,
    verbose: () => undefined,
  };
  if (options.resetInfrastructure !== false) await resetE2eInfrastructure();
  boundary.reset();

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PUSH_NOTIFICATION_PROVIDER)
    .useValue(capturingPush);
  if ((options.throttling ?? 'relaxed') === 'relaxed') {
    builder = builder.overrideProvider(ThrottlerStorage).useValue(relaxedThrottlerStorage);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: capturingLogger });
  configureApp(app);
  await app.init();
  await app.listen(0);
  const baseUrl = await app.getUrl().then((u) => u.replace('[::1]', '127.0.0.1'));

  const redis = new Redis(E2E_REDIS_URL);
  const ds = app.get(DataSource);

  const api: World['api'] = async (method, path, opts = {}) => {
    let req = request(baseUrl)[method](`/api/v1${path}`);
    if (opts.token) req = req.set('Authorization', `Bearer ${opts.token}`);
    for (const [k, v] of Object.entries(opts.headers ?? {})) req = req.set(k, v);
    if (opts.query) req = req.query(opts.query);
    if (opts.body !== undefined) req = req.send(opts.body as object);
    const res = await req;
    return { status: res.status, body: res.body, headers: res.headers as Record<string, string> };
  };

  return {
    logs,
    app,
    baseUrl,
    ds,
    redis,
    api,
    /** Unexpected 5xx the application logged through its HttpExceptionFilter. Journeys assert this is empty. */
    unhandledServerErrors: () => logs.filter((l) => l.level === 'error' && l.message.startsWith('Unhandled exception')).map((l) => l.message),
    async close() {
      await redis.quit();
      // Node keeps idle HTTP keep-alive sockets (client agent AND server) open, holding the process ~5s after close().
      http.globalAgent.destroy();
      (app.getHttpServer() as http.Server).closeAllConnections();
      await app.close();
    },
  };
}
