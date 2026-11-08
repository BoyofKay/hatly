import * as http from 'http';
import type { AddressInfo } from 'net';
import { LoggerService } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import * as request from 'supertest';
import * as passport from 'passport';
import { JwtStrategy } from '../../../src/modules/auth/strategies/jwt.strategy';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/app.setup';
import { PUSH_NOTIFICATION_PROVIDER, PushNotificationProvider } from '../../../src/modules/notifications/push-provider.interface';
import { WEB_PUSH_SENDER, WebPushSender } from '../../../src/modules/notifications/web-push/web-push-sender';
import { boundary } from './external-boundary';
import { E2E_REDIS_URL } from './config';
import { resetE2eInfrastructure } from './db';

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  /** The raw response text (the only way to read a non-JSON body such as a CSV download). */
  text: string;
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

/** Admin Web Push at the network edge: the real queue, worker, receipts and subscription rules run; only the push service is simulated. */
const capturingWebPush: WebPushSender = {
  isConfigured: () => boundary.webPushConfigured,
  publicKey: () => (boundary.webPushConfigured ? 'BE2E-test-public-key' : null),
  async send(target, payload, options) {
    boundary.webPush.push({ endpoint: target.endpoint, payload: JSON.parse(payload), ttlSeconds: options.ttlSeconds, urgency: options.urgency, topic: options.topic });
    const status = boundary.webPushQueue.length > 0 ? boundary.webPushQueue.shift()! : boundary.webPushStatus;
    if (status === 'network') throw new Error('socket hang up');
    return { statusCode: status };
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

/**
 * Passport keeps strategies in a PROCESS-WIDE registry, so when a test boots a second app (multi-instance scenarios) its JwtStrategy — and
 * that app's database connection — replaces the first app's. Production runs one app per process; here, closing an extra instance must hand
 * authentication back to the app still running, otherwise it would authenticate through a closed pool (the strategy looks staff accounts up
 * in the database). The stack keeps the booted instances in order.
 */
const jwtStrategyStack: JwtStrategy[] = [];

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
    .useValue(capturingPush)
    .overrideProvider(WEB_PUSH_SENDER)
    .useValue(capturingWebPush);
  if ((options.throttling ?? 'relaxed') === 'relaxed') {
    builder = builder.overrideProvider(ThrottlerStorage).useValue(relaxedThrottlerStorage);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: capturingLogger });
  configureApp(app);
  await app.init();
  const jwtStrategy = app.get(JwtStrategy);
  jwtStrategyStack.push(jwtStrategy);
  // Bound to 127.0.0.1, the address the tests call. On the wildcard address the OS may hand out a port that another process (e.g. an Android
  // emulator) already holds on 127.0.0.1 — macOS allows the overlap — and requests to 127.0.0.1 then reach that process and hang the run.
  await app.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

  const redis = new Redis(E2E_REDIS_URL);
  const ds = app.get(DataSource);

  const api: World['api'] = async (method, path, opts = {}) => {
    let req = request(baseUrl)[method](`/api/v1${path}`);
    if (opts.token) req = req.set('Authorization', `Bearer ${opts.token}`);
    for (const [k, v] of Object.entries(opts.headers ?? {})) req = req.set(k, v);
    if (opts.query) req = req.query(opts.query);
    if (opts.body !== undefined) req = req.send(opts.body as object);
    const res = await req;
    return { status: res.status, body: res.body, text: res.text ?? '', headers: res.headers as Record<string, string> };
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
      const at = jwtStrategyStack.indexOf(jwtStrategy);
      if (at >= 0) jwtStrategyStack.splice(at, 1);
      const stillRunning = jwtStrategyStack[jwtStrategyStack.length - 1];
      if (stillRunning) passport.use('jwt', stillRunning as never);
    },
  };
}
